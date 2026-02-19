/**
 * EL Annotations — per-image annotation GET/PUT.
 *
 * GET ?imageIndex=N
 *   Returns presigned image URL, bounding boxes for image N,
 *   total image count, and current index.
 *   Falls back to detections.json (AI output) if no human review exists.
 *
 * PUT ?imageIndex=N
 *   Saves human-reviewed bounding boxes for image N.
 */
const { s3 } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
const { normalizeEnv, getELBucketConfig } = require('../shared/env');
const { readJson, writeJson, getSignedGetUrl } = require('../shared/s3-utils');

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
  };
}

function parseBody(event) {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

async function listImageKeys(bucket, prefix) {
  const result = await s3
    .listObjectsV2({ Bucket: bucket, Prefix: prefix })
    .promise();
  return (result.Contents || [])
    .map((obj) => obj.Key)
    .filter((key) => /\.(jpg|jpeg|png|tif|tiff)$/i.test(key))
    .sort();
}

exports.handler = async (event) => {
  setRequestEvent(event);
  const method = (event.requestContext?.http?.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return preflightResponse();

  const { orgId, projectId } = getPathParams(event);
  if (!orgId || !projectId) {
    return errorResponse(400, 'Missing orgId or projectId');
  }

  const env = normalizeEnv(event.queryStringParameters?.env);
  const imageIndex = parseInt(event.queryStringParameters?.imageIndex || '0', 10);
  const { uploadsBucket, groundtruthBucket } = getELBucketConfig(env);

  if (!uploadsBucket || !groundtruthBucket) {
    return errorResponse(500, 'EL bucket configuration missing');
  }

  const imagesPrefix = `${orgId}/projects/${projectId}/images/`;

  if (method === 'GET') {
    try {
      const imageKeys = await listImageKeys(uploadsBucket, imagesPrefix);
      if (imageKeys.length === 0) {
        return jsonResponse(200, {
          imageUrl: null,
          annotations: { boundingBoxes: [] },
          totalImages: 0,
          currentIndex: 0,
          filename: '',
        });
      }

      const clampedIndex = Math.max(0, Math.min(imageIndex, imageKeys.length - 1));
      const currentKey = imageKeys[clampedIndex];
      const filename = currentKey.split('/').pop();

      // Generate presigned URL for the image
      const imageUrl = getSignedGetUrl(uploadsBucket, currentKey, 3600);

      // Try human-reviewed annotation first
      const annotationKey = `${orgId}/projects/${projectId}/annotations/${filename}.json`;
      let annotations = await readJson(groundtruthBucket, annotationKey);

      if (!annotations) {
        // Fall back to AI detections
        const detectionsKey = `${orgId}/projects/${projectId}/detections.json`;
        const allDetections = await readJson(groundtruthBucket, detectionsKey);
        if (allDetections && allDetections[filename]) {
          annotations = { boundingBoxes: allDetections[filename] };
        }
      }

      return jsonResponse(200, {
        imageUrl,
        annotations: annotations || { boundingBoxes: [] },
        totalImages: imageKeys.length,
        currentIndex: clampedIndex,
        filename,
      });
    } catch (error) {
      console.error('Failed to load EL annotations', error);
      return errorResponse(500, 'Failed to load EL annotations');
    }
  }

  if (method === 'PUT') {
    try {
      const body = parseBody(event);
      if (!body || !Array.isArray(body.boundingBoxes)) {
        return errorResponse(400, 'Invalid body: boundingBoxes must be an array');
      }

      // Determine filename for this image index
      const imageKeys = await listImageKeys(uploadsBucket, imagesPrefix);
      if (imageKeys.length === 0) {
        return errorResponse(400, 'No images found');
      }
      const clampedIndex = Math.max(0, Math.min(imageIndex, imageKeys.length - 1));
      const filename = imageKeys[clampedIndex].split('/').pop();

      // Save per-image annotation
      const annotationKey = `${orgId}/projects/${projectId}/annotations/${filename}.json`;
      await writeJson(groundtruthBucket, annotationKey, {
        boundingBoxes: body.boundingBoxes,
        reviewedAt: new Date().toISOString(),
      });

      return jsonResponse(200, {
        success: true,
        message: `Saved ${body.boundingBoxes.length} annotations for ${filename}`,
      });
    } catch (error) {
      console.error('Failed to save EL annotations', error);
      return errorResponse(500, 'Failed to save EL annotations');
    }
  }

  return errorResponse(405, 'Method not allowed');
};
