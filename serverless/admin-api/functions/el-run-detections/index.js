/**
 * EL Run Detections — mock model that generates random bounding boxes per image.
 *
 * Lists images from el-uploads bucket, generates 1-5 random defect boxes per image,
 * writes combined results to el-groundtruth bucket.
 *
 * Future: Replace with Batch job submission to real EL Detectron2 model.
 */
const { s3, dynamodb } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
const { normalizeEnv, getELBucketConfig, getProjectsTable } = require('../shared/env');
const { writeJson } = require('../shared/s3-utils');

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateMockBoxes(imageWidth, imageHeight) {
  const count = randomInt(1, 5);
  const boxes = [];
  for (let i = 0; i < count; i++) {
    const w = randomInt(30, Math.min(200, imageWidth / 3));
    const h = randomInt(30, Math.min(200, imageHeight / 3));
    const left = randomInt(10, imageWidth - w - 10);
    const top = randomInt(10, imageHeight - h - 10);
    boxes.push({ left, top, width: w, height: h, label: 'defects' });
  }
  return boxes;
}

exports.handler = async (event) => {
  setRequestEvent(event);
  const method = (event.requestContext?.http?.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return preflightResponse();
  if (method !== 'POST') return errorResponse(405, 'Method not allowed');

  try {
    const { orgId, projectId } = getPathParams(event);
    if (!orgId || !projectId) {
      return errorResponse(400, 'Missing orgId or projectId');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const { uploadsBucket, groundtruthBucket } = getELBucketConfig(env);
    if (!uploadsBucket || !groundtruthBucket) {
      return errorResponse(500, 'EL bucket configuration missing');
    }

    // List images in upload bucket
    const prefix = `${orgId}/projects/${projectId}/images/`;
    const listResult = await s3
      .listObjectsV2({ Bucket: uploadsBucket, Prefix: prefix })
      .promise();

    const imageKeys = (listResult.Contents || [])
      .map((obj) => obj.Key)
      .filter((key) => /\.(jpg|jpeg|png|tif|tiff)$/i.test(key));

    if (imageKeys.length === 0) {
      return errorResponse(400, 'No images found in upload bucket');
    }

    // Generate mock detections for each image
    // Use a reasonable default image size (640x480) for mock boxes
    const detections = {};
    for (const key of imageKeys) {
      const filename = key.split('/').pop();
      detections[filename] = generateMockBoxes(640, 480);
    }

    // Write detections to groundtruth bucket
    const detectionsKey = `${orgId}/projects/${projectId}/detections.json`;
    await writeJson(groundtruthBucket, detectionsKey, detections);

    // Update DynamoDB project status
    const projectsTable = getProjectsTable(env);
    if (projectsTable) {
      try {
        await dynamodb
          .update({
            TableName: projectsTable,
            Key: { PK: `PROJECT#${projectId}`, SK: 'METADATA' },
            UpdateExpression: 'SET #status = :s, updated_at = :t',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':s': 'detecting_complete',
              ':t': new Date().toISOString(),
            },
          })
          .promise();
      } catch (err) {
        console.warn('DynamoDB status update failed (non-critical):', err.message);
      }
    }

    return jsonResponse(200, {
      success: true,
      imageCount: imageKeys.length,
      totalDetections: Object.values(detections).reduce((sum, boxes) => sum + boxes.length, 0),
    });
  } catch (error) {
    console.error('Failed to run EL detections', error);
    return errorResponse(500, 'Failed to run EL detections');
  }
};
