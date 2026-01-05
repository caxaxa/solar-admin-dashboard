const { s3 } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getBucketConfig } = require('../shared/env');

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
  };
}

/**
 * GET: Retrieve the report.tex content for editing
 */
async function handleGet(event) {
  const { orgId, projectId } = getPathParams(event);
  if (!orgId || !projectId) {
    return errorResponse(400, 'Missing orgId or projectId');
  }

  const env = normalizeEnv(event.queryStringParameters?.env);
  const { reportsBucket } = getBucketConfig(env);
  const texKey = `${orgId}/projects/${projectId}/tex_bundle/report.tex`;

  try {
    const response = await s3.getObject({
      Bucket: reportsBucket,
      Key: texKey,
    }).promise();

    const content = response.Body.toString('utf-8');

    return jsonResponse(200, {
      success: true,
      content,
      lastModified: response.LastModified?.toISOString(),
      contentLength: response.ContentLength,
    });
  } catch (err) {
    if (err.code === 'NoSuchKey') {
      return errorResponse(404, 'TeX file not found. Generate a report first.');
    }
    console.error('Failed to get TeX content:', err);
    return errorResponse(500, 'Failed to retrieve TeX content');
  }
}

/**
 * PUT: Save edited report.tex content and create .edited marker
 */
async function handlePut(event) {
  const { orgId, projectId } = getPathParams(event);
  if (!orgId || !projectId) {
    return errorResponse(400, 'Missing orgId or projectId');
  }

  const env = normalizeEnv(event.queryStringParameters?.env);
  const { reportsBucket } = getBucketConfig(env);
  const texKey = `${orgId}/projects/${projectId}/tex_bundle/report.tex`;
  const markerKey = `${orgId}/projects/${projectId}/tex_bundle/.edited`;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return errorResponse(400, 'Invalid JSON body');
  }

  const { content } = body;
  if (!content || typeof content !== 'string') {
    return errorResponse(400, 'Missing or invalid "content" field');
  }

  try {
    // Save the updated TeX content
    await s3.putObject({
      Bucket: reportsBucket,
      Key: texKey,
      Body: content,
      ContentType: 'text/x-tex',
    }).promise();

    // Create the .edited marker file to indicate TeX was manually edited
    await s3.putObject({
      Bucket: reportsBucket,
      Key: markerKey,
      Body: JSON.stringify({
        editedAt: new Date().toISOString(),
        editedBy: 'admin-dashboard',
      }),
      ContentType: 'application/json',
    }).promise();

    console.log(`Saved TeX content (${content.length} chars) and created edit marker for ${projectId}`);

    return jsonResponse(200, {
      success: true,
      message: 'TeX content saved successfully',
      contentLength: content.length,
      markerCreated: true,
    });
  } catch (err) {
    console.error('Failed to save TeX content:', err);
    return errorResponse(500, 'Failed to save TeX content');
  }
}

exports.handler = async (event) => {
  const method = (event.requestContext?.http?.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return preflightResponse();
  }

  if (method === 'GET') {
    return handleGet(event);
  }

  if (method === 'PUT') {
    return handlePut(event);
  }

  return errorResponse(405, `Method ${method} not allowed`);
};
