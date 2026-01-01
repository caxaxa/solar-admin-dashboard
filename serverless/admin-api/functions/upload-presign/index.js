const { s3, dynamodb } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getProjectsTable } = require('../shared/env');
const { ulid } = require('ulid');

const UPLOADS_BUCKET_DEV = 'solar-uploads-dev';
const UPLOADS_BUCKET_PROD = 'solar-uploads-prod';

function getUploadsBucket(env) {
  return env === 'prod' ? UPLOADS_BUCKET_PROD : UPLOADS_BUCKET_DEV;
}

/**
 * Generate presigned URL for file upload.
 * Admin version - does not require user auth, uses orgId from path.
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
    const { orgId, projectId } = event.pathParameters || {};
    if (!orgId || !projectId) {
      return errorResponse(400, 'Missing orgId or projectId');
    }

    const body = JSON.parse(event.body || '{}');
    const { filename, content_type, file_size } = body;

    if (!filename) {
      return errorResponse(400, 'filename is required');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const uploadsBucket = getUploadsBucket(env);
    const projectsTable = getProjectsTable(env);

    // Generate file ID
    const fileId = ulid();

    // S3 key path
    const s3Key = `${orgId}/projects/${projectId}/raw/${fileId}_${filename}`;

    // Generate presigned URL for PUT
    const presignedUrl = s3.getSignedUrl('putObject', {
      Bucket: uploadsBucket,
      Key: s3Key,
      ContentType: content_type || 'application/octet-stream',
      Expires: 3600, // 1 hour
      Metadata: {
        'project-id': projectId,
        'file-id': fileId,
        'user-id': orgId,
        'original-filename': filename,
      },
    });

    // Record file in DynamoDB
    // Use size_bytes to match user app API convention
    const timestamp = Math.floor(Date.now() / 1000);
    await dynamodb.put({
      TableName: projectsTable,
      Item: {
        PK: `PROJECT#${projectId}`,
        SK: `FILE#${fileId}`,
        file_id: fileId,
        filename: filename,
        content_type: content_type || 'application/octet-stream',
        size_bytes: file_size || 0,
        s3_key: s3Key,
        s3_bucket: uploadsBucket,
        upload_status: 'pending',
        created_at: timestamp,
      },
    }).promise();

    console.log(`Generated presigned URL for ${filename} in project ${projectId}`);

    return jsonResponse(200, {
      upload_url: presignedUrl,
      file_id: fileId,
      project_id: projectId,
      s3_key: s3Key,
    });
  } catch (error) {
    console.error('Failed to generate presigned URL', error);
    return errorResponse(500, 'Failed to generate upload URL');
  }
};
