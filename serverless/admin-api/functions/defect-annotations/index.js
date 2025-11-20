const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getBucketConfig } = require('../shared/env');
const {
  readJson,
  writeJson,
  getSignedGetUrl,
} = require('../shared/s3-utils');

const CLASS_MAP = {
  0: 'default_panel',
  1: 'hotspots',
  2: 'faultydiodes',
  3: 'offlinepanels',
};

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
  };
}

function getEnv(event) {
  return normalizeEnv(event.queryStringParameters?.env);
}

function parseBody(event) {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || 'GET';
  if (method === 'OPTIONS') {
    return preflightResponse();
  }
  const { orgId, projectId } = getPathParams(event);

  if (!orgId || !projectId) {
    return errorResponse(400, 'Missing orgId or projectId');
  }

  const env = getEnv(event);
  const { groundtruthBucket, orthosBucket, reportsBucket } = getBucketConfig(env);
  if (!groundtruthBucket || !orthosBucket || !reportsBucket) {
    return errorResponse(500, 'Bucket configuration missing');
  }

  if (method === 'GET') {
    try {
      // Use the cropped JPEG version that matches the inference coordinates
      const imageKey = `${orgId}/projects/${projectId}/odm_orthophoto/odm_orthophoto_1.6cm.jpg`;
      const imageUrl = getSignedGetUrl(orthosBucket, imageKey);

      const gtPath = `${orgId}/projects/${projectId}/groundtruth`;
      const reportsPath = `${orgId}/projects/${projectId}`;

      // Paths to check (in order of preference)
      const humanReviewedKey = `${gtPath}/defect_labels.json`; // Human-reviewed annotations
      const inferenceKey = `${reportsPath}/defect_labels.json`; // Fresh inference results

      let annotations = [];

      // Try human-reviewed annotations first
      const savedAnnotations = await readJson(groundtruthBucket, humanReviewedKey);
      if (savedAnnotations) {
        console.log('Loaded human-reviewed annotations from groundtruth bucket');
        annotations = [savedAnnotations];
      } else {
        console.log('No human-reviewed annotations, trying inference results...');

        // Fall back to inference results from reports bucket
        const inferenceResults = await readJson(reportsBucket, inferenceKey);
        if (inferenceResults && Array.isArray(inferenceResults) && inferenceResults.length > 0) {
          console.log('Loaded inference results from reports bucket');
          // Inference results already in correct format, just need to remap labels
          const boxes = inferenceResults[0]?.boundingBox?.boundingBoxes || [];
          const remappedBoxes = boxes.map((box) => ({
            ...box,
            // Remap solarpanels -> default_panel for consistency
            label: box.label === 'solarpanels' ? 'default_panel' : box.label,
          }));
          annotations = [
            {
              boundingBox: {
                boundingBoxes: remappedBoxes,
              },
            },
          ];
        } else {
          console.log('No inference results found');
        }
      }

      return jsonResponse(200, {
        imageUrl,
        annotations,
      });
    } catch (error) {
      console.error('Failed to load annotations', error);
      return errorResponse(500, 'Failed to load annotations');
    }
  }

  if (method === 'PUT') {
    try {
      const body = parseBody(event);
      if (!body || !Array.isArray(body.boundingBoxes)) {
        return errorResponse(400, 'Invalid request body: boundingBoxes must be an array');
      }

      const gtPath = `${orgId}/projects/${projectId}/groundtruth`;
      const labelsKey = `${gtPath}/defect_labels.json`;
      const payload = {
        boundingBox: {
          boundingBoxes: body.boundingBoxes,
        },
      };

      await writeJson(groundtruthBucket, labelsKey, payload);
      return jsonResponse(200, {
        success: true,
        message: `Saved ${body.boundingBoxes.length} annotations`,
      });
    } catch (error) {
      console.error('Failed to save annotations', error);
      return errorResponse(500, 'Failed to save annotations');
    }
  }

  return errorResponse(405, 'Method not allowed');
};
