/**
 * EL Project Status — checks EL-specific S3 artifacts for pipeline progress.
 *
 * Returns boolean flags for each pipeline stage:
 *   hasImages, hasDetections, hasHumanReview, hasReport, isReleased
 */
const { s3 } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
const { normalizeEnv, getELBucketConfig } = require('../shared/env');
const { objectExists, getSignedGetUrl } = require('../shared/s3-utils');

const TRAINING_BUCKET = 'solar-ai-training';

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
  };
}

async function hasAnyObjects(bucket, prefix) {
  if (!bucket) return false;
  try {
    const result = await s3
      .listObjectsV2({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 })
      .promise();
    return (result.Contents || []).length > 0;
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  setRequestEvent(event);
  if ((event.requestContext?.http?.method || '').toUpperCase() === 'OPTIONS') {
    return preflightResponse();
  }

  try {
    const { orgId, projectId } = getPathParams(event);
    if (!orgId || !projectId) {
      return errorResponse(400, 'Missing orgId or projectId');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const { uploadsBucket, groundtruthBucket, reportsBucket } = getELBucketConfig(env);

    const [hasImages, hasDetections, hasHumanReview, hasReport] = await Promise.all([
      // Step 1: Images uploaded
      hasAnyObjects(uploadsBucket, `${orgId}/projects/${projectId}/images/`),
      // Step 2: AI detections generated
      objectExists(groundtruthBucket, `${orgId}/projects/${projectId}/detections.json`).catch(() => false),
      // Step 3: Human review completed (marker file)
      objectExists(groundtruthBucket, `${orgId}/projects/${projectId}/review-complete.json`).catch(() => false),
      // Step 4: Report generated
      objectExists(reportsBucket, `${orgId}/projects/${projectId}/report-full.pdf`).catch(() => false),
    ]);

    // Step 5: Released to training bucket
    const isReleased = await objectExists(
      TRAINING_BUCKET,
      `el/${orgId}/${projectId}/metadata.json`
    ).catch(() => false);

    // Signed URL for report PDF
    let reportFullUrl = null;
    if (hasReport) {
      try {
        reportFullUrl = getSignedGetUrl(
          reportsBucket,
          `${orgId}/projects/${projectId}/report-full.pdf`,
          7200
        );
      } catch (err) {
        console.warn('Failed to generate signed URL for EL report:', err);
      }
    }

    return jsonResponse(200, {
      hasImages,
      hasDetections,
      hasHumanReview,
      hasReport,
      isReleased,
      reportFullUrl,
    });
  } catch (error) {
    console.error('Failed to fetch EL project status', error);
    return errorResponse(500, 'Failed to fetch EL project status');
  }
};
