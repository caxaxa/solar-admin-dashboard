const { batch } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getJobResources } = require('../shared/env');

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
    actionType: params.actionType,
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
    const { orgId, projectId, actionType } = getPathParams(event);
    if (!orgId || !projectId || !actionType) {
      return errorResponse(400, 'Missing path parameters');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const { jobQueue, reportJobDefinition } = getJobResources(env);

    if (actionType === 'generate-report') {
      if (!jobQueue || !reportJobDefinition) {
        return errorResponse(500, 'Report job configuration missing');
      }

      const response = await batch
        .submitJob({
          jobName: `report-${projectId}-${Date.now()}`,
          jobQueue,
          jobDefinition: reportJobDefinition,
          containerOverrides: {
            environment: [
              { name: 'ORG_ID', value: orgId },
              { name: 'PROJECT_ID', value: projectId },
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
    }

    if (actionType === 'release') {
      return errorResponse(501, 'Release action not yet implemented');
    }

    return errorResponse(400, `Unknown action type: ${actionType}`);
  } catch (error) {
    console.error('Failed to execute project action', error);
    return errorResponse(500, 'Failed to execute action');
  }
};
