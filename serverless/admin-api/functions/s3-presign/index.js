/**
 * Generic S3 presigned URL generator
 *
 * Generates presigned URLs for GET or PUT operations on allowed S3 buckets.
 * Used by the admin dashboard to fetch/upload annotation manifests and overrides.
 */

const { s3 } = require('../shared/aws-clients');
const { ok, badRequest, serverError } = require('../shared/http');

// Allowed buckets for security - only permit access to these
const ALLOWED_BUCKETS = new Set([
  // Reports buckets (annotation manifests and overrides)
  'solar-reports-dev',
  'solar-reports-prod',
  // Uploads buckets (raw thermal images)
  'solar-uploads-dev',
  'solar-uploads-prod',
  // Orthos buckets (orthophotos and intermediates)
  'solar-orthos-dev',
  'solar-orthos-prod',
  // Groundtruth buckets
  'solar-groundtruth-dev',
  'solar-groundtruth-prod',
]);

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const { bucket, key, operation, contentType } = params;

    // Validate required parameters
    if (!bucket || !key || !operation) {
      return badRequest('Missing required parameters: bucket, key, operation');
    }

    // Validate bucket is allowed
    if (!ALLOWED_BUCKETS.has(bucket)) {
      return badRequest(`Bucket not allowed: ${bucket}`);
    }

    // Validate operation
    if (operation !== 'get' && operation !== 'put') {
      return badRequest('Operation must be "get" or "put"');
    }

    let url;
    const expiresIn = 3600; // 1 hour

    if (operation === 'get') {
      url = s3.getSignedUrl('getObject', {
        Bucket: bucket,
        Key: key,
        Expires: expiresIn,
      });
    } else {
      // PUT operation
      const putParams = {
        Bucket: bucket,
        Key: key,
        Expires: expiresIn,
      };

      if (contentType) {
        putParams.ContentType = contentType;
      }

      url = s3.getSignedUrl('putObject', putParams);
    }

    return ok({ url, bucket, key, operation, expiresIn });
  } catch (err) {
    console.error('Error generating presigned URL:', err);
    return serverError(err.message);
  }
};
