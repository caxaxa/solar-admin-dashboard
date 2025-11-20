const { batch } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getJobResources } = require('../shared/env');

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
  };
}

exports.handler = async (event) => {
  const method = (event.requestContext?.http?.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return preflightResponse();
  }
  if (method !== 'POST') {
    return errorResponse(405, 'Method not allowed');
  }

  try {
    const { orgId, projectId } = getPathParams(event);
    if (!orgId || !projectId) {
      return errorResponse(400, 'Missing orgId or projectId');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const { jobQueue, inferenceJobDefinition } = getJobResources(env);
    if (!jobQueue || !inferenceJobDefinition) {
      return errorResponse(500, 'Batch configuration missing');
    }

    // Use the original orthophoto path (not in subdirectory)
    const orthophotoKey = `${orgId}/projects/${projectId}/odm_orthophoto.tif`;

    // Determine bucket names and model URI based on environment
    const bucketSuffix = env === 'prod' ? 'prod' : 'dev';
    const orthosBucket = `solar-orthos-${bucketSuffix}`;
    const reportsBucket = `solar-reports-${bucketSuffix}`;
    const modelS3Uri = 's3://solar-ai-training/detectron2-solar-models/solar-detectron2-20251105-025543/model_final.pth';

    const response = await batch
      .submitJob({
        jobName: `inference-${projectId}-${Date.now()}`,
        jobQueue,
        jobDefinition: inferenceJobDefinition,
        containerOverrides: {
          environment: [
            { name: 'ORG_ID', value: orgId },
            { name: 'PROJECT_ID', value: projectId },
            { name: 'SOLAR_PROJECT_ID', value: projectId },
            { name: 'SOLAR_ORTHOPHOTO_KEY', value: orthophotoKey },
            { name: 'SOLAR_ORTHOS_BUCKET', value: orthosBucket },
            { name: 'SOLAR_REPORTS_BUCKET', value: reportsBucket },
            { name: 'SOLAR_MODEL_S3_URI', value: modelS3Uri },
            { name: 'ENVIRONMENT', value: env },
          ],
        },
      })
      .promise();

    return jsonResponse(200, {
      success: true,
      jobId: response.jobId,
      jobName: response.jobName,
    });
  } catch (error) {
    console.error('Failed to submit inference job', error);
    return errorResponse(500, 'Failed to submit inference job');
  }
};
