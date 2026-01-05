const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getBucketConfig } = require('../shared/env');
const { objectExists, getSignedGetUrl } = require('../shared/s3-utils');

const TRAINING_BUCKET = 'solar-ai-training';

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
  };
}

exports.handler = async (event) => {
  if ((event.requestContext?.http?.method || '').toUpperCase() === 'OPTIONS') {
    return preflightResponse();
  }
  try {
    const { orgId, projectId } = getPathParams(event);
    if (!orgId || !projectId) {
      return errorResponse(400, 'Missing orgId or projectId');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const { groundtruthBucket, orthosBucket, reportsBucket } = getBucketConfig(env);

    const [
      hasOrthophoto,
      hasCropAnnotation,
      hasInferenceResults,
      hasHumanReview,
      hasReport,
      hasTexEdit,
    ] = await Promise.all([
      // Step 2: ODM creates original TIF
      objectExists(orthosBucket, `${orgId}/projects/${projectId}/odm_orthophoto.tif`).catch(() => false),
      // Step 3: Human crop/rotate annotation
      objectExists(groundtruthBucket, `${orgId}/projects/${projectId}/groundtruth/crop_annotation.json`).catch(() => false),
      // Step 4: AI Inference creates defect labels in reports bucket
      objectExists(reportsBucket, `${orgId}/projects/${projectId}/defect_labels.json`).catch(() => false),
      // Step 5: Human review saves to groundtruth bucket
      objectExists(groundtruthBucket, `${orgId}/projects/${projectId}/groundtruth/defect_labels.json`).catch(() => false),
      // Step 6: Report generation
      objectExists(reportsBucket, `${orgId}/projects/${projectId}/thermographic-report/report-lowres.pdf`).catch(() => false),
      // Check if TeX has been manually edited (marker file exists in tex_bundle)
      objectExists(reportsBucket, `${orgId}/projects/${projectId}/tex_bundle/.edited`).catch(() => false),
    ]);

    // Check if project is released by looking for metadata.json in training bucket
    const isReleased = await objectExists(
      TRAINING_BUCKET,
      `${orgId}/${projectId}/metadata.json`
    ).catch(() => false);

    // Generate signed URL for full-resolution report PDF if report exists
    let reportFullUrl = null;
    if (hasReport) {
      const reportFullKey = `${orgId}/projects/${projectId}/thermographic-report/report-full.pdf`;
      try {
        // Check if full-res exists, fallback to lowres
        const hasFullRes = await objectExists(reportsBucket, reportFullKey);
        const pdfKey = hasFullRes
          ? reportFullKey
          : `${orgId}/projects/${projectId}/thermographic-report/report-lowres.pdf`;
        reportFullUrl = getSignedGetUrl(reportsBucket, pdfKey, 7200); // 2 hour expiry
      } catch (err) {
        console.warn('Failed to generate signed URL for report:', err);
      }
    }

    return jsonResponse(200, {
      hasOrthophoto,
      hasCropAnnotation,
      hasInferenceResults,
      hasHumanReview,
      hasReport,
      reportFullUrl,
      isReleased,
      hasTexEdit,
    });
  } catch (error) {
    console.error('Failed to fetch project status', error);
    return errorResponse(500, 'Failed to fetch project status');
  }
};
