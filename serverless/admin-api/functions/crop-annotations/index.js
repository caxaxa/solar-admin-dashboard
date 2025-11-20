const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getBucketConfig } = require('../shared/env');
const {
  objectExists,
  readJson,
  writeJson,
  getSignedGetUrl,
} = require('../shared/s3-utils');

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
  };
}

function getEnv(event) {
  const envParam = event.queryStringParameters?.env;
  return normalizeEnv(envParam);
}

function parseBody(event) {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch (err) {
    console.error('Failed to parse JSON body', err);
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
  const { groundtruthBucket, orthosBucket } = getBucketConfig(env);

  if (!groundtruthBucket || !orthosBucket) {
    return errorResponse(500, 'Bucket configuration missing');
  }

  if (method === 'GET') {
    try {
      // Match the path the batch job expects
      const annotationsKey = `${orgId}/projects/${projectId}/groundtruth/crop_annotation.json`;

      // For crop annotation, we need a browser-viewable format (JPG/PNG) not TIF
      // Try to find a preview/JPG version of the original orthophoto
      const imageCandidates = [
        `${orgId}/projects/${projectId}/odm_orthophoto.jpg`,
        `${orgId}/projects/${projectId}/odm_orthophoto_preview.png`,
        `${orgId}/projects/${projectId}/odm_orthophoto/odm_orthophoto_preview.jpg`,
      ];

      let imageUrl = null;
      for (const candidate of imageCandidates) {
        const exists = await objectExists(orthosBucket, candidate);
        if (exists) {
          imageUrl = getSignedGetUrl(orthosBucket, candidate);
          console.log(`Using crop annotation image: ${candidate}`);
          break;
        }
      }

      if (!imageUrl) {
        console.error('No viewable orthophoto image found for project', { orgId, projectId });
        return errorResponse(404, 'No preview image found. Please ensure ODM processing is complete.');
      }

      const imageMetadata = null;

      const defaultAnnotations = {
        polygon: [],
        rotationLine: null,
        isDouble: false,
        isVertical: false,
        is2H: false,
      };
      let annotations = defaultAnnotations;
      try {
        const storedAnnotations = await readJson(groundtruthBucket, annotationsKey);
        if (storedAnnotations) {
          annotations = storedAnnotations;
        }
      } catch (error) {
        console.warn('Failed to read stored crop annotations, returning defaults', {
          orgId,
          projectId,
          env,
          error: error instanceof Error ? error.message : error,
        });
      }

      return jsonResponse(200, {
        imageUrl,
        imageMetadata,
        annotations,
      });
    } catch (error) {
      console.error('Failed to fetch crop annotations', error);
      return errorResponse(500, 'Failed to fetch crop annotations');
    }
  }

  if (method === 'PUT') {
    try {
      const annotations = parseBody(event);
      if (!annotations || !Array.isArray(annotations.polygon)) {
        return errorResponse(400, 'Invalid annotations payload');
      }

      // Match the path the batch job expects
      const annotationsKey = `${orgId}/projects/${projectId}/groundtruth/crop_annotation.json`;
      await writeJson(groundtruthBucket, annotationsKey, annotations);
      return jsonResponse(200, { success: true });
    } catch (error) {
      console.error('Failed to save crop annotations', error);
      return errorResponse(500, 'Failed to save crop annotations');
    }
  }

  return errorResponse(405, 'Method not allowed');
};
