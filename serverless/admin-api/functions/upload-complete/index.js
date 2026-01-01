const { s3, dynamodb } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getProjectsTable } = require('../shared/env');

const UPLOADS_BUCKET_DEV = 'solar-uploads-dev';
const UPLOADS_BUCKET_PROD = 'solar-uploads-prod';

function getUploadsBucket(env) {
  return env === 'prod' ? UPLOADS_BUCKET_PROD : UPLOADS_BUCKET_DEV;
}

/**
 * Mark a file upload as completed and optionally finalize the project upload.
 */
exports.handler = async (event) => {
  const method = (event.requestContext?.http?.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return preflightResponse();
  }

  if (method !== 'POST') {
    return errorResponse(405, 'Method not allowed');
  }

  try {
    const { orgId, projectId, fileId } = event.pathParameters || {};
    if (!orgId || !projectId || !fileId) {
      return errorResponse(400, 'Missing path parameters');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const uploadsBucket = getUploadsBucket(env);
    const projectsTable = getProjectsTable(env);

    // Get the file record
    const fileResult = await dynamodb.get({
      TableName: projectsTable,
      Key: {
        PK: `PROJECT#${projectId}`,
        SK: `FILE#${fileId}`,
      },
    }).promise();

    if (!fileResult.Item) {
      return errorResponse(404, 'File not found');
    }

    const fileRecord = fileResult.Item;

    // Verify the file exists in S3
    try {
      const headResult = await s3.headObject({
        Bucket: uploadsBucket,
        Key: fileRecord.s3_key,
      }).promise();

      // Update file record with completed status and actual size
      // Use size_bytes to match user app API convention
      const timestamp = Math.floor(Date.now() / 1000);
      await dynamodb.update({
        TableName: projectsTable,
        Key: {
          PK: `PROJECT#${projectId}`,
          SK: `FILE#${fileId}`,
        },
        UpdateExpression: 'SET upload_status = :status, uploaded_at = :timestamp, size_bytes = :size',
        ExpressionAttributeValues: {
          ':status': 'completed',
          ':timestamp': timestamp,
          ':size': headResult.ContentLength,
        },
      }).promise();

      console.log(`File ${fileId} upload completed for project ${projectId}`);

      return jsonResponse(200, {
        success: true,
        file_id: fileId,
        size_bytes: headResult.ContentLength,
      });
    } catch (err) {
      if (err.code === 'NotFound') {
        return errorResponse(404, 'File not found in S3');
      }
      throw err;
    }
  } catch (error) {
    console.error('Failed to complete file upload', error);
    return errorResponse(500, 'Failed to complete upload');
  }
};
