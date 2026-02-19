const { dynamodb } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
const { normalizeEnv, getProjectsTable } = require('../shared/env');

/**
 * Finalize project upload - update project with file counts and change status.
 */
exports.handler = async (event) => {
  setRequestEvent(event);
  const method = (event.requestContext?.http?.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return preflightResponse();
  }

  if (method !== 'POST') {
    return errorResponse(405, 'Method not allowed');
  }

  try {
    const { orgId, projectId } = event.pathParameters || {};
    if (!orgId || !projectId) {
      return errorResponse(400, 'Missing path parameters');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const projectsTable = getProjectsTable(env);

    // Get all file records for this project
    const filesResult = await dynamodb.query({
      TableName: projectsTable,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROJECT#${projectId}`,
        ':sk': 'FILE#',
      },
    }).promise();

    const files = filesResult.Items || [];
    const completedFiles = files.filter(f => f.upload_status === 'completed');

    if (completedFiles.length === 0) {
      return errorResponse(400, 'No completed uploads found');
    }

    // Calculate totals
    const fileCount = completedFiles.length;
    const totalSizeBytes = completedFiles.reduce((sum, f) => sum + (f.file_size || 0), 0);

    // Update project metadata
    const timestamp = Math.floor(Date.now() / 1000);
    await dynamodb.update({
      TableName: projectsTable,
      Key: {
        PK: `PROJECT#${projectId}`,
        SK: 'METADATA',
      },
      UpdateExpression: 'SET #status = :status, status_message = :message, file_count = :count, total_size_bytes = :size, updated_at = :timestamp, GSI2SK = :gsi2sk',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'uploading',
        ':message': 'Files uploaded by admin, ready for validation',
        ':count': fileCount,
        ':size': totalSizeBytes,
        ':timestamp': timestamp,
        ':gsi2sk': `STATUS#UPLOADING#UPDATED#${timestamp}`,
      },
    }).promise();

    console.log(`Finalized upload for project ${projectId}: ${fileCount} files, ${totalSizeBytes} bytes`);

    return jsonResponse(200, {
      success: true,
      project_id: projectId,
      file_count: fileCount,
      total_size_bytes: totalSizeBytes,
      status: 'uploading',
    });
  } catch (error) {
    console.error('Failed to finalize upload', error);
    return errorResponse(500, 'Failed to finalize upload');
  }
};
