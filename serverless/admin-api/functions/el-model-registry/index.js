/**
 * EL Model Registry Lambda — mirrors functions/model-registry/index.js (thermal)
 * but operates on the EL training data and EL model artifacts:
 *
 *   Archives:  s3://solar-ai-training/el/{org}/{project}/                   (consumed by training)
 *   Datasets:  s3://solar-ai-training/el/datasets/                          (built by --build-only mode)
 *   Manifests: s3://solar-ai-training/el/manifests/                         (one per Prepare click)
 *   Weights:   s3://solar-ai-training/detectron2-el-models/{version}/...    (uploaded by training job)
 *   Registry:  DynamoDB table solar-el-model-registry-{env}
 *   Pointer:   PK="MODEL#PROD_POINTER" → current_production = active EL version
 *   Batch:     job def solar-el-training-{env}, runs both COCO --build-only and full training
 *
 * Routes (mirrors thermal /api/model-registry/* with /api/el-model-registry/*):
 *   GET    /api/el-model-registry
 *   POST   /api/el-model-registry/sync-metrics
 *   POST   /api/el-model-registry/prepare
 *   POST   /api/el-model-registry/{version}/launch
 *   POST   /api/el-model-registry/{version}/promote
 *   DELETE /api/el-model-registry/{version}
 *   GET    /api/el-training-data/archives
 *   POST   /api/el-training-data/manifests
 *   POST   /api/el-training-data/coco
 *   POST   /api/el-training-data/coco/status
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  DeleteCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { BatchClient, SubmitJobCommand } = require('@aws-sdk/client-batch');

function ulid() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return ts + rand;
}

const ddbRaw = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbRaw);
const s3 = new S3Client({});
const batchClient = new BatchClient({});

const ENV = process.env.ENVIRONMENT || 'dev';
const TRAINING_DATA_BUCKET = process.env.TRAINING_DATA_BUCKET || 'solar-ai-training';
const EL_MODEL_REGISTRY_TABLE =
  process.env.EL_MODEL_REGISTRY_TABLE || `solar-el-model-registry-${ENV}`;
const PROD_POINTER_PK = 'MODEL#PROD_POINTER';
const EL_TRAINING_JOB_QUEUE =
  process.env.EL_TRAINING_JOB_QUEUE || `solar-gpu-queue-v2`;
const EL_TRAINING_JOB_DEFINITION =
  process.env.EL_TRAINING_JOB_DEFINITION || `solar-el-training-${ENV}`;
const EL_ARCHIVES_PREFIX = 'el/';                        // archives under here
const EL_DATASETS_PREFIX = 'el/datasets/';               // COCO tars
const EL_MANIFESTS_PREFIX = 'el/manifests/';             // manifest JSONs
const EL_WEIGHTS_PREFIX = 'detectron2-el-models/';       // model_final.pth
const DEFAULT_BATCH_SIZE = parseInt(process.env.EL_TRAINING_BATCH_SIZE || '2', 10);
const DEFAULT_ITERS = parseInt(process.env.EL_TRAINING_DEFAULT_ITERS || '800', 10);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

let _event = null;
function getCorsOrigin() {
  const origin = _event?.headers?.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (origin.startsWith('http://localhost:')) return origin;
  return ALLOWED_ORIGINS[0] || '';
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(),
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Request-ID',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Expose-Headers': 'X-Request-ID',
  };
}

const ok = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders(),
  body: JSON.stringify(body),
});

async function s3BodyToString(body) {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function parseS3Uri(uri) {
  if (!uri || !uri.startsWith('s3://')) return null;
  const without = uri.replace('s3://', '');
  const firstSlash = without.indexOf('/');
  if (firstSlash === -1) return null;
  return { bucket: without.slice(0, firstSlash), key: without.slice(firstSlash + 1) };
}

function safeParse(payload) {
  try {
    return payload ? JSON.parse(payload) : {};
  } catch (e) {
    return {};
  }
}

function truncateJobName(name) {
  if (name.length <= 118) return name;
  return name.slice(0, 118);
}

function timestampSlug() {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
}

exports.handler = async (event) => {
  _event = event;
  if (event.isBase64Encoded && event.body) {
    event.body = Buffer.from(event.body, 'base64').toString('utf-8');
    event.isBase64Encoded = false;
  }
  try {
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return ok(200, { status: 'ok' });
    }

    const path = event.requestContext?.http?.path || '';
    const method = event.requestContext?.http?.method || 'GET';

    if (path === '/api/el-model-registry' && method === 'GET') {
      return await listModels();
    }
    if (path === '/api/el-model-registry/sync-metrics' && method === 'POST') {
      return await syncMetrics();
    }
    if (path === '/api/el-model-registry/prepare' && method === 'POST') {
      return await prepareRetrain(safeParse(event.body) || {});
    }
    if (path === '/api/el-training-data/archives' && method === 'GET') {
      return await listArchives();
    }
    if (path === '/api/el-training-data/manifests' && method === 'POST') {
      return await createManifest();
    }
    if (path === '/api/el-training-data/coco' && method === 'POST') {
      return await buildCocoArchive(safeParse(event.body) || {});
    }
    if (path === '/api/el-training-data/coco/status' && method === 'POST') {
      return await checkDatasetReady(safeParse(event.body) || {});
    }

    const launchMatch = path.match(/^\/api\/el-model-registry\/([^/]+)\/launch$/);
    if (launchMatch && method === 'POST') {
      const v = decodeURIComponent(launchMatch[1]);
      return await launchRetrainJob(v, safeParse(event.body) || {});
    }
    const promoteMatch = path.match(/^\/api\/el-model-registry\/([^/]+)\/promote$/);
    if (promoteMatch && method === 'POST') {
      const v = decodeURIComponent(promoteMatch[1]);
      return await promoteModel(v, safeParse(event.body) || {});
    }
    const deleteMatch = path.match(/^\/api\/el-model-registry\/([^/]+)$/);
    if (deleteMatch && method === 'DELETE') {
      const v = decodeURIComponent(deleteMatch[1]);
      return await deleteModel(v);
    }

    return ok(404, { error: 'Not found' });
  } catch (err) {
    console.error('EL model registry handler error', err);
    return ok(500, { error: 'Internal server error', detail: err.message });
  }
};

// ---------- Registry ops ----------

async function getProdPointer() {
  const resp = await ddb.send(new GetCommand({
    TableName: EL_MODEL_REGISTRY_TABLE,
    Key: { model_version: PROD_POINTER_PK },
  }));
  return resp.Item ? resp.Item.current_production : null;
}

async function listModels() {
  const pointer = await getProdPointer();
  const resp = await ddb.send(new ScanCommand({
    TableName: EL_MODEL_REGISTRY_TABLE,
    Limit: 200,
  }));
  const items = (resp.Items || []).filter(
    (item) => item.model_version && item.model_version !== PROD_POINTER_PK
  );
  items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return ok(200, { models: items, production_model: pointer });
}

async function deleteModel(modelVersion) {
  if (!modelVersion || modelVersion === PROD_POINTER_PK) {
    return ok(400, { error: 'Invalid model version' });
  }
  const getResp = await ddb.send(new GetCommand({
    TableName: EL_MODEL_REGISTRY_TABLE,
    Key: { model_version: modelVersion },
  }));
  if (getResp.Item?.is_production) {
    return ok(400, { error: 'Cannot delete the current production model. Promote a different model first.' });
  }
  await ddb.send(new DeleteCommand({
    TableName: EL_MODEL_REGISTRY_TABLE,
    Key: { model_version: modelVersion },
  }));
  return ok(200, { message: 'Model deleted', model_version: modelVersion });
}

async function promoteModel(modelVersion, body) {
  const now = Math.floor(Date.now() / 1000);
  const getResp = await ddb.send(new GetCommand({
    TableName: EL_MODEL_REGISTRY_TABLE,
    Key: { model_version: modelVersion },
  }));
  if (!getResp.Item) return ok(404, { error: 'Model not found in registry' });

  const currentProd = await getProdPointer();

  await ddb.send(new PutCommand({
    TableName: EL_MODEL_REGISTRY_TABLE,
    Item: {
      model_version: PROD_POINTER_PK,
      current_production: modelVersion,
      updated_at: now,
      promoted_by: body?.promoted_by || 'admin',
    },
  }));

  if (currentProd && currentProd !== modelVersion) {
    await ddb.send(new UpdateCommand({
      TableName: EL_MODEL_REGISTRY_TABLE,
      Key: { model_version: currentProd },
      UpdateExpression: 'SET is_production = :false, #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':false': false, ':status': 'archived' },
    }));
  }

  await ddb.send(new UpdateCommand({
    TableName: EL_MODEL_REGISTRY_TABLE,
    Key: { model_version: modelVersion },
    UpdateExpression:
      'SET is_production = :true, #status = :status, promoted_at = :ts, promoted_by = :by',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':true': true,
      ':status': 'production',
      ':ts': now,
      ':by': body?.promoted_by || 'admin',
    },
  }));

  if (!getResp.Item.metrics) {
    const metrics = await fetchMetricsForModel(modelVersion);
    if (metrics) {
      await ddb.send(new UpdateCommand({
        TableName: EL_MODEL_REGISTRY_TABLE,
        Key: { model_version: modelVersion },
        UpdateExpression: 'SET metrics = :m',
        ExpressionAttributeValues: { ':m': metrics },
      }));
    }
  }

  return ok(200, { model_version: modelVersion, status: 'production', message: 'Model promoted' });
}

async function fetchMetricsForModel(modelVersion) {
  // Training writes coco_eval results to: s3://solar-ai-training/detectron2-el-models/{version}/final_results.json
  const key = `${EL_WEIGHTS_PREFIX}${modelVersion}/final_results.json`;
  try {
    const resp = await s3.send(new GetObjectCommand({
      Bucket: TRAINING_DATA_BUCKET,
      Key: key,
    }));
    const raw = await s3BodyToString(resp.Body);
    const sanitized = raw.replace(/NaN/g, 'null');
    const parsed = JSON.parse(sanitized);
    const bbox = parsed.bbox || {};
    const round2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
    return { AP: round2(bbox.AP), AP50: round2(bbox.AP50), AP75: round2(bbox.AP75) };
  } catch (e) {
    console.error('fetchMetricsForModel: failed for', modelVersion, e.message);
    return null;
  }
}

async function syncMetrics() {
  const resp = await ddb.send(new ScanCommand({
    TableName: EL_MODEL_REGISTRY_TABLE,
    Limit: 200,
  }));
  const items = (resp.Items || []).filter(
    (item) => item.model_version && item.model_version !== PROD_POINTER_PK
  );

  let synced = 0, skipped = 0, failed = 0;
  for (const item of items) {
    if (item.metrics) {
      skipped++;
      continue;
    }
    const metrics = await fetchMetricsForModel(item.model_version);
    if (!metrics) {
      failed++;
      continue;
    }
    try {
      await ddb.send(new UpdateCommand({
        TableName: EL_MODEL_REGISTRY_TABLE,
        Key: { model_version: item.model_version },
        UpdateExpression: 'SET metrics = :m',
        ExpressionAttributeValues: { ':m': metrics },
      }));
      synced++;
    } catch (e) {
      console.error('syncMetrics: DDB update failed for', item.model_version, e.message);
      failed++;
    }
  }
  return ok(200, { synced, skipped, failed, total: items.length });
}

// ---------- Archives ----------

const TRAINED_INDEX_KEY = 'el/trained-index.json';

async function backfillTrainedIndex() {
  const index = { trained: {} };
  try {
    const resp = await ddb.send(new ScanCommand({ TableName: EL_MODEL_REGISTRY_TABLE, Limit: 200 }));
    const trainedModels = (resp.Items || []).filter(
      (item) =>
        item.model_version &&
        item.model_version !== PROD_POINTER_PK &&
        item.manifest_uri &&
        ['submitted', 'production', 'archived'].includes(item.status)
    );
    for (const model of trainedModels) {
      const parsed = parseS3Uri(model.manifest_uri);
      if (!parsed) continue;
      try {
        const mResp = await s3.send(new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }));
        const manifest = JSON.parse(await s3BodyToString(mResp.Body));
        for (const a of manifest.archives || []) {
          const archiveKey = `${a.org_id || 'na'}|${a.project_id || a.source_key || ''}`;
          index.trained[archiveKey] = {
            model_version: model.model_version,
            trained_at: model.created_at
              ? new Date(model.created_at * 1000).toISOString()
              : new Date().toISOString(),
          };
        }
      } catch (e) {
        console.error('backfill: failed to read manifest for', model.model_version, e.message);
      }
    }
    await s3.send(new PutObjectCommand({
      Bucket: TRAINING_DATA_BUCKET,
      Key: TRAINED_INDEX_KEY,
      Body: JSON.stringify(index, null, 2),
      ContentType: 'application/json',
    }));
  } catch (e) {
    console.error('backfillTrainedIndex error', e);
  }
  return index;
}

async function getTrainedIndex() {
  try {
    const resp = await s3.send(new GetObjectCommand({
      Bucket: TRAINING_DATA_BUCKET,
      Key: TRAINED_INDEX_KEY,
    }));
    return JSON.parse(await s3BodyToString(resp.Body));
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
      return await backfillTrainedIndex();
    }
    console.error('getTrainedIndex error', e);
    return { trained: {} };
  }
}

async function updateTrainedIndex(manifestUri, modelVersion) {
  const index = await getTrainedIndex();
  const now = new Date().toISOString();
  const parsed = parseS3Uri(manifestUri);
  if (!parsed) return;
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }));
    const manifest = JSON.parse(await s3BodyToString(resp.Body));
    for (const a of manifest.archives || []) {
      const archiveKey = `${a.org_id || 'na'}|${a.project_id || a.source_key || ''}`;
      index.trained[archiveKey] = { model_version: modelVersion, trained_at: now };
    }
    await s3.send(new PutObjectCommand({
      Bucket: TRAINING_DATA_BUCKET,
      Key: TRAINED_INDEX_KEY,
      Body: JSON.stringify(index, null, 2),
      ContentType: 'application/json',
    }));
  } catch (e) {
    console.error('updateTrainedIndex error', e);
  }
}

async function listAllELMetadataKeys() {
  // Walk only s3://solar-ai-training/el/ — skip datasets/manifests/trained-index
  let continuationToken;
  const keys = [];
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: TRAINING_DATA_BUCKET,
      Prefix: EL_ARCHIVES_PREFIX,
      ContinuationToken: continuationToken,
    }));
    for (const obj of resp.Contents || []) {
      if (!obj.Key || !obj.Key.endsWith('metadata.json')) continue;
      if (obj.Key.startsWith(EL_DATASETS_PREFIX)) continue;
      if (obj.Key.startsWith(EL_MANIFESTS_PREFIX)) continue;
      if (obj.Key === TRAINED_INDEX_KEY) continue;
      keys.push(obj.Key);
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function listFilesInPrefix(prefix, metadataKey) {
  let continuationToken;
  const files = [];
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: TRAINING_DATA_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const obj of resp.Contents || []) {
      if (!obj.Key || obj.Key === metadataKey) continue;
      files.push(`s3://${TRAINING_DATA_BUCKET}/${obj.Key}`);
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);
  return files;
}

async function listArchives() {
  const [metadataKeys, trainedIndex] = await Promise.all([
    listAllELMetadataKeys(),
    getTrainedIndex(),
  ]);

  const archives = [];
  for (const key of metadataKeys) {
    // Layout: el/{org_id}/{project_id}/metadata.json
    const parts = key.split('/').filter(Boolean);
    let orgId = null;
    let projectId = null;
    if (parts.length >= 3) {
      orgId = parts[1];
      projectId = parts[2];
    }
    const basePrefix = key.slice(0, key.lastIndexOf('/') + 1);
    const archivedFiles = await listFilesInPrefix(basePrefix, key);

    const archiveKey = `${orgId || 'na'}|${projectId || key}`;
    const trainedEntry = trainedIndex.trained[archiveKey];

    archives.push({
      org_id: orgId,
      project_id: projectId,
      metadata_uri: `s3://${TRAINING_DATA_BUCKET}/${key}`,
      archived_files: archivedFiles,
      source_key: key,
      training_status: trainedEntry ? 'trained' : 'untrained',
      trained_in_model: trainedEntry ? trainedEntry.model_version : null,
      trained_at: trainedEntry ? trainedEntry.trained_at : null,
    });
  }

  archives.sort((a, b) => (b.project_id || '').localeCompare(a.project_id || ''));

  const trainedCount = archives.filter((a) => a.training_status === 'trained').length;
  const untrainedCount = archives.filter((a) => a.training_status === 'untrained').length;

  return ok(200, {
    archives,
    count: archives.length,
    trained_count: trainedCount,
    untrained_count: untrainedCount,
    training_bucket: TRAINING_DATA_BUCKET,
    archives_prefix: EL_ARCHIVES_PREFIX,
  });
}

// ---------- Manifest + COCO ----------

async function createManifest() {
  const archivesResp = await listArchives();
  const archivesBody = safeParse(archivesResp.body);
  const archives = archivesBody.archives || [];

  const manifest = {
    generated_at: new Date().toISOString(),
    modality: 'el',
    archive_count: archives.length,
    archives,
  };

  const ts = timestampSlug();
  const key = `${EL_MANIFESTS_PREFIX}manifest-${ts}.json`;

  await s3.send(new PutObjectCommand({
    Bucket: TRAINING_DATA_BUCKET,
    Key: key,
    Body: JSON.stringify(manifest, null, 2),
    ContentType: 'application/json',
  }));

  manifest.manifest_uri = `s3://${TRAINING_DATA_BUCKET}/${key}`;
  manifest.manifest_key = key;
  return ok(200, manifest);
}

async function buildCocoArchive(body) {
  const manifestUri = body.manifest_uri;
  if (!manifestUri) return ok(400, { error: 'manifest_uri is required' });

  const targetUri =
    body.dataset_upload_uri ||
    `s3://${TRAINING_DATA_BUCKET}/${EL_DATASETS_PREFIX}el-coco-${timestampSlug()}.tar.gz`;

  const jobName = truncateJobName(`el-coco-${ulid().slice(0, 6)}`);
  const submit = await batchClient.send(new SubmitJobCommand({
    jobName,
    jobQueue: EL_TRAINING_JOB_QUEUE,
    jobDefinition: EL_TRAINING_JOB_DEFINITION,
    containerOverrides: {
      command: [
        '--build-only',
        '--manifest-uri', manifestUri,
        '--dataset-upload-uri', targetUri,
      ],
      environment: [
        { name: 'MANIFEST_URI', value: manifestUri },
        { name: 'OUTPUT_BUCKET', value: TRAINING_DATA_BUCKET },
        { name: 'DATASET_UPLOAD_URI', value: targetUri },
      ],
    },
  }));

  return ok(200, {
    message: 'EL COCO build job submitted',
    dataset_upload_uri: targetUri,
    batch_job_id: submit.jobId,
    batch_job_name: submit.jobName,
  });
}

async function checkDatasetReady(body) {
  const datasetUri = body.dataset_uri || body.dataset_upload_uri;
  if (!datasetUri) return ok(400, { error: 'dataset_uri is required' });
  const parsed = parseS3Uri(datasetUri);
  if (!parsed) return ok(400, { error: 'dataset_uri must be an s3:// URI' });
  try {
    await s3.send(new HeadObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }));
    return ok(200, { dataset_uri: datasetUri, exists: true });
  } catch (e) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
      return ok(200, { dataset_uri: datasetUri, exists: false });
    }
    console.error('checkDatasetReady error', e);
    return ok(500, { error: 'Failed to check dataset', detail: e.message });
  }
}

// ---------- Prepare + Launch ----------

async function prepareRetrain(body) {
  // 1) Generate manifest from archives
  const manifestResp = await createManifest();
  const manifest = safeParse(manifestResp.body);
  const manifestUri = manifest.manifest_uri;

  // 2) Allocate model_version + dataset URI
  const modelVersion = `el-${timestampSlug()}-${ulid().slice(0, 6)}`;
  const datasetUploadUri =
    `s3://${TRAINING_DATA_BUCKET}/${EL_DATASETS_PREFIX}el-coco-${modelVersion}.tar.gz`;

  // 3) Submit COCO build (--build-only)
  const cocoJob = await batchClient.send(new SubmitJobCommand({
    jobName: truncateJobName(`el-coco-${modelVersion}`),
    jobQueue: EL_TRAINING_JOB_QUEUE,
    jobDefinition: EL_TRAINING_JOB_DEFINITION,
    containerOverrides: {
      command: [
        '--build-only',
        '--manifest-uri', manifestUri,
        '--dataset-upload-uri', datasetUploadUri,
      ],
      environment: [
        { name: 'MANIFEST_URI', value: manifestUri },
        { name: 'OUTPUT_BUCKET', value: TRAINING_DATA_BUCKET },
        { name: 'DATASET_UPLOAD_URI', value: datasetUploadUri },
        { name: 'RUN_NAME', value: modelVersion },
      ],
    },
  }));

  // 4) Create registry entry
  const now = Math.floor(Date.now() / 1000);
  const epochs = parseInt(body.epochs || '0', 10);
  const batchSize = parseInt(body.batch_size || DEFAULT_BATCH_SIZE, 10);

  const item = {
    model_version: modelVersion,
    created_at: now,
    created_by: body.triggered_by || 'admin',
    manifest_uri: manifestUri,
    base_model_version: body.base_model_version,
    training_params: {
      epochs: epochs || null,
      batch_size: batchSize,
      dataset_archive_uri: datasetUploadUri,
    },
    notes: body.notes || '',
    status: 'queued',
    coco_job_id: cocoJob.jobId,
    coco_job_name: cocoJob.jobName,
  };
  await ddb.send(new PutCommand({ TableName: EL_MODEL_REGISTRY_TABLE, Item: item }));

  return ok(200, {
    message: 'Prepare submitted: manifest created, COCO build queued, registry entry created.',
    model_version: modelVersion,
    manifest_uri: manifestUri,
    dataset_archive_uri: datasetUploadUri,
    coco_job_id: cocoJob.jobId,
    coco_job_name: cocoJob.jobName,
  });
}

function computeMaxIter(epochs) {
  const e = parseInt(epochs || '0', 10);
  if (!e || Number.isNaN(e)) return DEFAULT_ITERS;
  // Heuristic: ~50 iters per epoch on the small EL dataset (20 images @ batch 2 ≈ 10 iters/epoch
  // x 5 to give some headroom). Bump as the corpus grows.
  return Math.max(200, e * 50);
}

async function launchRetrainJob(modelVersion, body) {
  const prodPointer = await getProdPointer();

  const getResp = await ddb.send(new GetCommand({
    TableName: EL_MODEL_REGISTRY_TABLE,
    Key: { model_version: modelVersion },
  }));
  const existing = getResp.Item;
  if (!existing) return ok(404, { error: 'Model not found' });

  const datasetArchiveUri =
    body.dataset_archive_uri ||
    existing.training_params?.dataset_archive_uri ||
    `s3://${TRAINING_DATA_BUCKET}/${EL_DATASETS_PREFIX}el-coco-${modelVersion}.tar.gz`;
  const manifestUri = body.manifest_uri || existing.manifest_uri;
  const epochs = parseInt(body.epochs || existing.training_params?.epochs || '0', 10);
  const batchSize = parseInt(
    body.batch_size || existing.training_params?.batch_size || DEFAULT_BATCH_SIZE,
    10
  );
  const baseModelVersion =
    body.base_model_version || existing.base_model_version || prodPointer || null;
  const maxIter = parseInt(
    body.max_iter || existing.training_params?.max_iter || computeMaxIter(epochs),
    10
  );
  const outputPrefixUri =
    body.output_prefix_uri ||
    `s3://${TRAINING_DATA_BUCKET}/${EL_WEIGHTS_PREFIX}${modelVersion}`;

  // Resolve base_weights_uri from the registered base model's weights_uri (mirror thermal pattern,
  // but EL stores weights_uri explicitly because path conventions differ between v1 bootstrap and
  // training-job output)
  let baseWeightsUri = body.base_weights_uri || null;
  if (!baseWeightsUri && baseModelVersion) {
    const base = await ddb.send(new GetCommand({
      TableName: EL_MODEL_REGISTRY_TABLE,
      Key: { model_version: baseModelVersion },
    }));
    baseWeightsUri = base.Item?.weights_uri || null;
  }
  // If still missing, use the conventional path
  if (!baseWeightsUri && baseModelVersion) {
    baseWeightsUri = `s3://${TRAINING_DATA_BUCKET}/${EL_WEIGHTS_PREFIX}${baseModelVersion}/model_final.pth`;
  }

  if (!manifestUri) {
    return ok(400, { error: 'manifest_uri missing; run Prepare first' });
  }

  // Validate dataset tar exists (Prepare's COCO build must have finished)
  if (datasetArchiveUri) {
    const parsed = parseS3Uri(datasetArchiveUri);
    if (!parsed) return ok(400, { error: 'dataset_archive_uri must be an s3:// URI' });
    try {
      await s3.send(new HeadObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }));
    } catch (e) {
      return ok(400, {
        error: 'Dataset archive not found yet. Let the COCO build finish before launching training.',
        dataset_archive_uri: datasetArchiveUri,
      });
    }
  }

  // Validate manifest exists
  {
    const parsed = parseS3Uri(manifestUri);
    if (parsed) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }));
      } catch (e) {
        return ok(400, { error: 'Manifest not found', manifest_uri: manifestUri });
      }
    }
  }

  // Validate base weights exist (if any)
  if (baseWeightsUri) {
    const parsed = parseS3Uri(baseWeightsUri);
    if (parsed) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }));
      } catch (e) {
        return ok(400, {
          error: 'Base weights not found. Ensure the base model has model_final.pth.',
          base_weights_uri: baseWeightsUri,
        });
      }
    }
  }

  const jobName = truncateJobName(`el-train-${modelVersion}`);
  const command = [
    '--dataset-archive-uri', datasetArchiveUri,
    '--manifest-uri', manifestUri,
    '--output-prefix-uri', outputPrefixUri,
    '--batch-size', String(batchSize),
    '--max-iter', String(maxIter),
  ];

  const submit = await batchClient.send(new SubmitJobCommand({
    jobName,
    jobQueue: EL_TRAINING_JOB_QUEUE,
    jobDefinition: EL_TRAINING_JOB_DEFINITION,
    containerOverrides: {
      command,
      environment: [
        { name: 'MANIFEST_URI', value: manifestUri },
        { name: 'OUTPUT_BUCKET', value: TRAINING_DATA_BUCKET },
        { name: 'DATASET_UPLOAD_URI', value: datasetArchiveUri },
        { name: 'OUTPUT_PREFIX_URI', value: outputPrefixUri },
        { name: 'RUN_NAME', value: modelVersion },
        ...(baseWeightsUri ? [{ name: 'BASE_WEIGHTS_URI', value: baseWeightsUri }] : []),
      ],
    },
  }));

  const now = Math.floor(Date.now() / 1000);
  const weightsUri = `${outputPrefixUri.replace(/\/$/, '')}/model_final.pth`;

  await ddb.send(new UpdateCommand({
    TableName: EL_MODEL_REGISTRY_TABLE,
    Key: { model_version: modelVersion },
    UpdateExpression:
      'SET #status = :status, batch_job_id = :jobId, batch_job_name = :jobName, training_params = :tp, manifest_uri = :manifest, weights_uri = :weights, updated_at = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'submitted',
      ':jobId': submit.jobId,
      ':jobName': submit.jobName,
      ':tp': {
        ...(existing.training_params || {}),
        epochs: epochs || existing.training_params?.epochs || null,
        batch_size: batchSize,
        max_iter: maxIter,
        base_model_version: baseModelVersion || null,
        base_weights_uri: baseWeightsUri || null,
        dataset_archive_uri: datasetArchiveUri,
      },
      ':manifest': manifestUri,
      ':weights': weightsUri,
      ':now': now,
    },
  }));

  if (manifestUri) {
    await updateTrainedIndex(manifestUri, modelVersion);
  }

  return ok(200, {
    model_version: modelVersion,
    status: 'submitted',
    batch_job_id: submit.jobId,
    batch_job_name: submit.jobName,
    manifest_uri: manifestUri,
    weights_uri: weightsUri,
    max_iter: maxIter,
    epochs: epochs || null,
  });
}
