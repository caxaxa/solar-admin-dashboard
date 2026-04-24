/**
 * EL Project Status — checks EL-specific S3 artifacts for pipeline progress.
 *
 * Returns boolean flags for each pipeline stage:
 *   hasImages, hasDetections, hasHumanReview, hasReport, isReleased
 *
 * Also reports the current AWS Batch detection job status (when one is in
 * flight) by reading stages.detection.job_id from DynamoDB and calling
 * batch.describeJobs. When the Batch job transitions to a terminal state
 * (SUCCEEDED / FAILED), the new status is written back to DynamoDB so the
 * admin UI can stop polling.
 */
const { s3, dynamodb, batch } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
const { normalizeEnv, getELBucketConfig, getProjectsTable } = require('../shared/env');
const { objectExists, getSignedGetUrl } = require('../shared/s3-utils');

const TRAINING_BUCKET = 'solar-ai-training';
const TERMINAL_BATCH_STATES = new Set(['SUCCEEDED', 'FAILED']);

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

async function getDetectionStage(projectsTable, projectId) {
  if (!projectsTable) return null;
  try {
    const resp = await dynamodb
      .get({
        TableName: projectsTable,
        Key: { PK: `PROJECT#${projectId}`, SK: 'METADATA' },
        ProjectionExpression: 'stages',
      })
      .promise();
    return resp.Item?.stages?.detection || null;
  } catch (err) {
    console.warn('Failed to read detection stage from DynamoDB:', err.message);
    return null;
  }
}

async function describeBatchJob(jobId) {
  try {
    const resp = await batch.describeJobs({ jobs: [jobId] }).promise();
    return (resp.jobs && resp.jobs[0]) || null;
  } catch (err) {
    console.warn('batch.describeJobs failed for %s: %s', jobId, err.message);
    return null;
  }
}

async function persistTerminalDetectionStatus(projectsTable, projectId, existingStage, batchJob) {
  const now = new Date().toISOString();
  const nextStage = {
    ...existingStage,
    status: batchJob.status === 'SUCCEEDED' ? 'detecting_complete' : 'detecting_failed',
    batch_status: batchJob.status,
    status_reason: batchJob.statusReason || null,
    completed_at: now,
  };
  try {
    await dynamodb
      .update({
        TableName: projectsTable,
        Key: { PK: `PROJECT#${projectId}`, SK: 'METADATA' },
        UpdateExpression: 'SET #status = :s, updated_at = :t, stages.#d = :d',
        ExpressionAttributeNames: { '#status': 'status', '#d': 'detection' },
        ExpressionAttributeValues: {
          ':s': nextStage.status,
          ':t': now,
          ':d': nextStage,
        },
      })
      .promise();
  } catch (err) {
    console.warn('Failed to persist terminal detection status:', err.message);
  }
  return nextStage;
}

async function resolveDetectionJob(projectsTable, projectId) {
  const stage = await getDetectionStage(projectsTable, projectId);
  if (!stage || !stage.job_id) return null;

  // If we already persisted a terminal state, return it as-is without hitting Batch.
  if (TERMINAL_BATCH_STATES.has(stage.batch_status)) {
    return {
      jobId: stage.job_id,
      jobName: stage.job_name || null,
      status: stage.batch_status,
      statusReason: stage.status_reason || null,
      mode: stage.mode || 'batch',
      submittedAt: stage.submitted_at || null,
      completedAt: stage.completed_at || null,
    };
  }

  const batchJob = await describeBatchJob(stage.job_id);
  if (!batchJob) {
    return {
      jobId: stage.job_id,
      jobName: stage.job_name || null,
      status: stage.batch_status || 'UNKNOWN',
      statusReason: stage.status_reason || null,
      mode: stage.mode || 'batch',
      submittedAt: stage.submitted_at || null,
      completedAt: null,
    };
  }

  let effectiveStage = stage;
  if (TERMINAL_BATCH_STATES.has(batchJob.status)) {
    effectiveStage = await persistTerminalDetectionStatus(projectsTable, projectId, stage, batchJob);
  }

  return {
    jobId: stage.job_id,
    jobName: batchJob.jobName || stage.job_name || null,
    status: batchJob.status,
    statusReason: batchJob.statusReason || null,
    mode: effectiveStage.mode || 'batch',
    submittedAt: stage.submitted_at || null,
    completedAt: effectiveStage.completed_at || null,
  };
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
    const projectsTable = getProjectsTable(env);

    const [hasImages, hasDetections, hasHumanReview, hasReport, detectionJob] = await Promise.all([
      hasAnyObjects(uploadsBucket, `${orgId}/projects/${projectId}/images/`),
      objectExists(groundtruthBucket, `${orgId}/projects/${projectId}/detections.json`).catch(() => false),
      objectExists(groundtruthBucket, `${orgId}/projects/${projectId}/review-complete.json`).catch(() => false),
      objectExists(reportsBucket, `${orgId}/projects/${projectId}/report-full.pdf`).catch(() => false),
      resolveDetectionJob(projectsTable, projectId),
    ]);

    const isReleased = await objectExists(
      TRAINING_BUCKET,
      `el/${orgId}/${projectId}/metadata.json`
    ).catch(() => false);

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
      detectionJob,
    });
  } catch (error) {
    console.error('Failed to fetch EL project status', error);
    return errorResponse(500, 'Failed to fetch EL project status');
  }
};
