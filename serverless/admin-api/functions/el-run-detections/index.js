/**
 * EL Run Detections — trigger defect detection for an EL project.
 *
 * Two modes controlled by EL_INFERENCE_MODE env var:
 *   - "batch" (production):  submit solar-el-inference-{env} AWS Batch job, track
 *                            jobId in DynamoDB (stages.detection.*). Mirrors the
 *                            thermal RunInferenceFunction pattern.
 *   - "mock"  (default):     generate random bounding boxes per image and write
 *                            detections.json directly. Kept so the UI keeps
 *                            working until a real EL Detectron2 model exists.
 *
 * On release, labeled EL data is archived to s3://solar-ai-training/el/... by
 * el-project-actions; that's the corpus the real EL model is eventually
 * trained on — same flywheel as thermal.
 */
const { s3, dynamodb, batch } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
const { normalizeEnv, getELBucketConfig, getELJobResources, getProjectsTable } = require('../shared/env');
const { writeJson } = require('../shared/s3-utils');

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Multi-class EL taxonomy — must stay in sync with:
//   - solar-admin-dashboard/src/components/el/ELAnnotationTool.tsx LABEL_CONFIG
//   - solar-detection-model/deploy/training_el/prepare_coco.py CATEGORIES
//   - solar-web-app/iac/cdk/lib/solar-stack.ts EL_CLASSES env var
const MOCK_LABELS = ['crack', 'micro-crack', 'finger-interruption', 'dead-cell'];

function generateMockBoxes(imageWidth, imageHeight) {
  const count = randomInt(1, 5);
  const boxes = [];
  for (let i = 0; i < count; i++) {
    const w = randomInt(30, Math.min(200, imageWidth / 3));
    const h = randomInt(30, Math.min(200, imageHeight / 3));
    const left = randomInt(10, imageWidth - w - 10);
    const top = randomInt(10, imageHeight - h - 10);
    const label = MOCK_LABELS[randomInt(0, MOCK_LABELS.length - 1)];
    boxes.push({ left, top, width: w, height: h, label });
  }
  return boxes;
}

async function listImageKeys(bucket, prefix) {
  const keys = [];
  let continuationToken;
  do {
    const resp = await s3
      .listObjectsV2({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken })
      .promise();
    (resp.Contents || []).forEach((obj) => {
      if (/\.(jpg|jpeg|png|tif|tiff|bmp)$/i.test(obj.Key)) keys.push(obj.Key);
    });
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function updateDetectionStage(projectsTable, projectId, patch) {
  if (!projectsTable) return;
  const now = new Date().toISOString();
  const merged = { ...patch, updated_at: now };
  try {
    await dynamodb
      .update({
        TableName: projectsTable,
        Key: { PK: `PROJECT#${projectId}`, SK: 'METADATA' },
        UpdateExpression:
          'SET #status = :s, updated_at = :t, stages = if_not_exists(stages, :empty), stages.#detection = :d',
        ExpressionAttributeNames: { '#status': 'status', '#detection': 'detection' },
        ExpressionAttributeValues: {
          ':s': patch.status,
          ':t': now,
          ':empty': {},
          ':d': merged,
        },
      })
      .promise();
  } catch (err) {
    console.warn('DynamoDB detection stage update failed (non-critical):', err.message);
  }
}

async function runMock({ uploadsBucket, groundtruthBucket, orgId, projectId, projectsTable }) {
  const prefix = `${orgId}/projects/${projectId}/images/`;
  const imageKeys = await listImageKeys(uploadsBucket, prefix);
  if (imageKeys.length === 0) {
    return errorResponse(400, 'No images found in upload bucket');
  }

  const detections = {};
  for (const key of imageKeys) {
    const filename = key.split('/').pop();
    detections[filename] = generateMockBoxes(640, 480);
  }

  const detectionsKey = `${orgId}/projects/${projectId}/detections.json`;
  await writeJson(groundtruthBucket, detectionsKey, detections);

  await updateDetectionStage(projectsTable, projectId, {
    mode: 'mock',
    status: 'detecting_complete',
    completed_at: new Date().toISOString(),
  });

  return jsonResponse(200, {
    success: true,
    mode: 'mock',
    imageCount: imageKeys.length,
    totalDetections: Object.values(detections).reduce((sum, boxes) => sum + boxes.length, 0),
  });
}

async function runBatch({
  env,
  uploadsBucket,
  groundtruthBucket,
  orgId,
  projectId,
  projectsTable,
  inferenceJobDefinition,
  jobQueue,
}) {
  if (!inferenceJobDefinition || !jobQueue) {
    return errorResponse(
      500,
      'EL inference Batch job not configured (EL_INFERENCE_JOB_DEF / JOB_QUEUE missing)',
    );
  }

  const prefix = `${orgId}/projects/${projectId}/images/`;
  const imageKeys = await listImageKeys(uploadsBucket, prefix);
  if (imageKeys.length === 0) {
    return errorResponse(400, 'No images found in upload bucket');
  }

  const jobName = `el-inference-${projectId}-${Date.now()}`;
  const submission = await batch
    .submitJob({
      jobName,
      jobQueue,
      jobDefinition: inferenceJobDefinition,
      containerOverrides: {
        environment: [
          { name: 'ORG_ID', value: orgId },
          { name: 'PROJECT_ID', value: projectId },
          { name: 'ENVIRONMENT', value: env },
          { name: 'EL_UPLOADS_BUCKET', value: uploadsBucket },
          { name: 'EL_GROUNDTRUTH_BUCKET', value: groundtruthBucket },
        ],
      },
    })
    .promise();

  const now = new Date().toISOString();
  await updateDetectionStage(projectsTable, projectId, {
    mode: 'batch',
    status: 'detecting',
    job_id: submission.jobId,
    job_name: submission.jobName,
    submitted_at: now,
    image_count: imageKeys.length,
  });

  return jsonResponse(202, {
    success: true,
    mode: 'batch',
    jobId: submission.jobId,
    jobName: submission.jobName,
    imageCount: imageKeys.length,
  });
}

exports.handler = async (event) => {
  setRequestEvent(event);
  const method = (event.requestContext?.http?.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return preflightResponse();
  if (method !== 'POST') return errorResponse(405, 'Method not allowed');

  try {
    const { orgId, projectId } = getPathParams(event);
    if (!orgId || !projectId) {
      return errorResponse(400, 'Missing orgId or projectId');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const { uploadsBucket, groundtruthBucket } = getELBucketConfig(env);
    if (!uploadsBucket || !groundtruthBucket) {
      return errorResponse(500, 'EL bucket configuration missing');
    }
    const projectsTable = getProjectsTable(env);
    const { inferenceJobDefinition, jobQueue, inferenceMode } = getELJobResources(env);

    // Allow per-request override (?mode=batch|mock) for testing; falls back to env default.
    const requestedMode = (event.queryStringParameters?.mode || inferenceMode || 'mock').toLowerCase();
    const mode = requestedMode === 'batch' ? 'batch' : 'mock';

    if (mode === 'batch') {
      return await runBatch({
        env,
        uploadsBucket,
        groundtruthBucket,
        orgId,
        projectId,
        projectsTable,
        inferenceJobDefinition,
        jobQueue,
      });
    }
    return await runMock({ uploadsBucket, groundtruthBucket, orgId, projectId, projectsTable });
  } catch (error) {
    console.error('Failed to run EL detections', error);
    return errorResponse(500, 'Failed to run EL detections');
  }
};
