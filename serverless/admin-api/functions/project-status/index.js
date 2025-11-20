const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getBucketConfig } = require('../shared/env');
const { objectExists } = require('../shared/s3-utils');

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
    ]);

    return jsonResponse(200, {
      hasOrthophoto,
      hasCropAnnotation,
      hasInferenceResults,
      hasHumanReview,
      hasReport,
    });
  } catch (error) {
    console.error('Failed to fetch project status', error);
    return errorResponse(500, 'Failed to fetch project status');
  }
};
