/**
 * IV Project Status — checks IV-specific S3 artifacts for pipeline progress.
 *
 * Returns boolean flags for each pipeline stage:
 *   hasData, hasSTCTranslation, hasReview, hasReport, isReleased
 */
const { s3 } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
const { normalizeEnv, getIVBucketConfig } = require('../shared/env');
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
    const { uploadsBucket, reportsBucket } = getIVBucketConfig(env);

    const [hasData, hasSTCTranslation, hasReview, hasReport] = await Promise.all([
      // Step 1: IV data files uploaded
      hasAnyObjects(uploadsBucket, `${orgId}/projects/${projectId}/data/`),
      // Step 2: STC translation completed (marker file written by run-stc-translation action)
      objectExists(reportsBucket, `${orgId}/projects/${projectId}/stc-translation-complete.json`).catch(() => false),
      // Step 3: Admin review completed (marker file)
      objectExists(reportsBucket, `${orgId}/projects/${projectId}/review-complete.json`).catch(() => false),
      // Step 4: Report generated
      objectExists(reportsBucket, `${orgId}/projects/${projectId}/report-full.pdf`).catch(() => false),
    ]);

    // Step 5: Released to training bucket
    const isReleased = await objectExists(
      TRAINING_BUCKET,
      `iv/${orgId}/${projectId}/metadata.json`
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
        console.warn('Failed to generate signed URL for IV report:', err);
      }
    }

    return jsonResponse(200, {
      hasData,
      hasSTCTranslation,
      hasReview,
      hasReport,
      isReleased,
      reportFullUrl,
    });
  } catch (error) {
    console.error('Failed to fetch IV project status', error);
    return errorResponse(500, 'Failed to fetch IV project status');
  }
};
