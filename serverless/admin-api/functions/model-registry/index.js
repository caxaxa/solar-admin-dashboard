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

// ulid is not bundled in the runtime — use a simple timestamp+random fallback
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
const MODEL_REGISTRY_TABLE = process.env.MODEL_REGISTRY_TABLE || `solar-model-registry-${ENV}`;
const PROD_POINTER_PK = process.env.MODEL_REGISTRY_PROD_POINTER_PK || 'MODEL#PROD_POINTER';
const RETRAIN_JOB_QUEUE = process.env.RETRAIN_JOB_QUEUE || `solar-job-queue-${ENV}`;
const RETRAIN_JOB_DEFINITION =
  process.env.RETRAIN_JOB_DEFINITION || 'solar-detectron2-training-gpu:1';
const COCO_JOB_QUEUE = process.env.COCO_JOB_QUEUE || RETRAIN_JOB_QUEUE;
const COCO_JOB_DEFINITION = process.env.COCO_JOB_DEFINITION || RETRAIN_JOB_DEFINITION;
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || TRAINING_DATA_BUCKET;
const DATASET_UPLOAD_PREFIX =
  process.env.DATASET_UPLOAD_PREFIX || `s3://${TRAINING_DATA_BUCKET}/datasets`;
const DEFAULT_BATCH_SIZE = parseInt(process.env.RETRAIN_BATCH_SIZE || '2', 10);
const DEFAULT_CHECKPOINT_EPOCHS = parseInt(process.env.RETRAIN_CHECKPOINT_EPOCHS || '20', 10);
const DEFAULT_EVAL_EPOCHS = parseInt(process.env.RETRAIN_EVAL_EPOCHS || '6', 10);
const PROD_MODEL_PREFIX = process.env.PROD_MODEL_PREFIX || 'model-registry';
const TRAINED_INDEX_KEY = 'training-data/trained-index.json';

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

// Helper: read S3 object body as string (v3 returns a stream)
async function s3BodyToString(body) {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

exports.handler = async (event) => {
  _event = event;
  // API Gateway HTTP API may base64-encode the request body
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

    if (path === '/api/model-registry' && method === 'GET') {
      return await listModels();
    }

    if (path === '/api/training-data/archives' && method === 'GET') {
      return await listArchives();
    }

    if (path === '/api/training-data/manifests' && method === 'POST') {
      return await createManifest();
    }

  if (path === '/api/training-data/coco' && method === 'POST') {
    const body = safeParse(event.body);
    return await buildCocoArchive(body || {});
  }

  if (path === '/api/training-data/coco/status' && method === 'POST') {
    const body = safeParse(event.body);
    return await checkDatasetReady(body || {});
  }

  if (path === '/api/model-registry/prepare' && method === 'POST') {
    const body = safeParse(event.body);
    return await prepareRetrain(body || {});
  }

  if (path === '/api/model-registry/retrain' && method === 'POST') {
    const body = safeParse(event.body);
    return await triggerRetrain(body || {});
  }

    const launchMatch = path.match(/^\/api\/model-registry\/([^/]+)\/launch$/);
    if (launchMatch && method === 'POST') {
      const modelVersion = decodeURIComponent(launchMatch[1]);
      const body = safeParse(event.body);
      return await launchRetrainJob(modelVersion, body || {});
    }

    const deleteMatch = path.match(/^\/api\/model-registry\/([^/]+)$/);
    if (deleteMatch && method === 'DELETE') {
      const modelVersion = decodeURIComponent(deleteMatch[1]);
      return await deleteModel(modelVersion);
    }

    const promoteMatch = path.match(/^\/api\/model-registry\/([^/]+)\/promote$/);
    if (promoteMatch && method === 'POST') {
      const modelVersion = decodeURIComponent(promoteMatch[1]);
      const body = safeParse(event.body);
      return await promoteModel(modelVersion, body || {});
    }

    if (path === '/api/model-registry/sync-metrics' && method === 'POST') {
      return await syncMetrics();
    }

    return ok(404, { error: 'Not found' });
  } catch (err) {
    console.error('Model registry handler error', err);
    return ok(500, { error: 'Internal server error', detail: err.message });
  }
};

function safeParse(payload) {
  try {
    return payload ? JSON.parse(payload) : {};
  } catch (e) {
    return {};
  }
}

async function checkDatasetReady(body) {
  const datasetUri = body.dataset_uri || body.dataset_upload_uri;
  if (!datasetUri) {
    return ok(400, { error: 'dataset_uri is required' });
  }

  const parsed = parseS3Uri(datasetUri);
  if (!parsed) {
    return ok(400, { error: 'dataset_uri must be an s3:// URI' });
  }

  try {
    await s3.send(new HeadObjectCommand({
      Bucket: parsed.bucket,
      Key: parsed.key,
    }));
    return ok(200, { dataset_uri: datasetUri, exists: true });
  } catch (e) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
      return ok(200, { dataset_uri: datasetUri, exists: false });
    }
    console.error('checkDatasetReady error', e);
    return ok(500, { error: 'Failed to check dataset', detail: e.message });
  }
}

async function getProdPointer() {
  const resp = await ddb.send(new GetCommand({
    TableName: MODEL_REGISTRY_TABLE,
    Key: { model_version: PROD_POINTER_PK },
  }));
  return resp.Item ? resp.Item.current_production : null;
}

async function listModels() {
  const pointer = await getProdPointer();
  const resp = await ddb.send(new ScanCommand({
    TableName: MODEL_REGISTRY_TABLE,
    Limit: 200,
  }));

  const items = (resp.Items || []).filter(
    (item) => item.model_version && item.model_version !== PROD_POINTER_PK
  );

  items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  return ok(200, {
    models: items,
    production_model: pointer,
  });
}

async function backfillTrainedIndex() {
  const index = { trained: {} };
  try {
    const resp = await ddb.send(new ScanCommand({ TableName: MODEL_REGISTRY_TABLE, Limit: 200 }));
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
          const archiveKey = `${a.user_id || 'na'}|${a.project_id || a.source_key || ''}`;
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
      // Lazy backfill from existing model records
      return await backfillTrainedIndex();
    }
    console.error('getTrainedIndex error', e);
    return { trained: {} };
  }
}

async function updateTrainedIndex(manifestUri, modelVersion) {
  const index = await getTrainedIndex();
  const now = new Date().toISOString();

  // Read the manifest to get all archive keys
  const parsed = parseS3Uri(manifestUri);
  if (!parsed) return;

  try {
    const resp = await s3.send(new GetObjectCommand({
      Bucket: parsed.bucket,
      Key: parsed.key,
    }));
    const manifest = JSON.parse(await s3BodyToString(resp.Body));
    const archives = manifest.archives || [];

    for (const a of archives) {
      const archiveKey = `${a.user_id || 'na'}|${a.project_id || a.source_key || ''}`;
      index.trained[archiveKey] = {
        model_version: modelVersion,
        trained_at: now,
      };
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

async function listArchives() {
  const [metadataKeys, trainedIndex] = await Promise.all([
    listAllMetadataKeys(),
    getTrainedIndex(),
  ]);

  const archives = [];
  const seen = new Set();

  for (const key of metadataKeys) {
    if (seen.has(key)) continue;
    seen.add(key);

    const parts = key.split('/').filter(Boolean);
    if (parts[0] === 'models' || parts[0] === 'detectron2-solar-models') continue;
    if (key.endsWith('training_metadata.json')) continue;

    let userId = null;
    let projectId = null;
    let date = null;
    const basePrefix = key.slice(0, key.lastIndexOf('/') + 1);

    if (parts[0] === 'training-data') {
      // Legacy/explicit training-data/{date}/{project}/metadata.json
      if (parts.length >= 3) {
        date = parts[1];
        projectId = parts[2];
      }
    } else {
      // Current upload layout: {userId}/{projectId}/[optional date]/metadata.json
      if (parts.length >= 2) {
        userId = parts[0];
        projectId = parts[1];
      }
      if (parts.length >= 3 && parts[2] !== 'metadata.json') {
        date = parts[2];
      }
    }

    const archivedFiles = await listFilesInPrefix(basePrefix, key);

    const archiveKey = `${userId || 'na'}|${projectId || key}`;
    const trainedEntry = trainedIndex.trained[archiveKey];

    const archive = {
      user_id: userId,
      project_id: projectId,
      date,
      metadata_uri: `s3://${TRAINING_DATA_BUCKET}/${key}`,
      archived_files: archivedFiles,
      source_key: key,
      training_status: trainedEntry ? 'trained' : 'untrained',
      trained_in_model: trainedEntry ? trainedEntry.model_version : null,
      trained_at: trainedEntry ? trainedEntry.trained_at : null,
    };

    archives.push(archive);
  }

  // Deduplicate by (user, project); prefer entries with explicit dates
  const deduped = new Map();
  for (const a of archives) {
    const k = `${a.user_id || 'na'}|${a.project_id || a.source_key}`;
    if (!deduped.has(k)) {
      deduped.set(k, a);
      continue;
    }
    const existing = deduped.get(k);
    const existingHasDate = Boolean(existing.date);
    const candidateHasDate = Boolean(a.date);
    if (candidateHasDate && !existingHasDate) {
      deduped.set(k, a);
    } else if (candidateHasDate && existingHasDate) {
      // Keep the one with lexicographically newer date
      if ((a.date || '') > (existing.date || '')) {
        deduped.set(k, a);
      }
    }
  }

  const archiveList = Array.from(deduped.values());

  archiveList.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    if (da === db) return (b.project_id || '').localeCompare(a.project_id || '');
    return db.localeCompare(da);
  });

  const trainedCount = archiveList.filter((a) => a.training_status === 'trained').length;
  const untrainedCount = archiveList.filter((a) => a.training_status === 'untrained').length;

  return ok(200, {
    archives: archiveList,
    count: archiveList.length,
    trained_count: trainedCount,
    untrained_count: untrainedCount,
    training_bucket: TRAINING_DATA_BUCKET,
  });
}

async function createManifest() {
  const archivesResp = await listArchives();
  const archivesBody = safeParse(archivesResp.body);
  const archives = archivesBody.archives || [];

  const manifest = {
    generated_at: new Date().toISOString(),
    archive_count: archives.length,
    archives,
  };

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
  const key = `training-data/manifests/manifest-${timestamp}.json`;

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

async function triggerRetrain(body) {
  const modelVersion = `model-${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}-${ulid().slice(0, 6)}`;
  const now = Math.floor(Date.now() / 1000);

  const item = {
    model_version: modelVersion,
    created_at: now,
    created_by: body.triggered_by || 'admin',
    manifest_uri: body.manifest_uri,
    base_model_version: body.base_model_version,
    training_params: body.training_params || {},
    notes: body.notes || '',
    status: 'queued',
  };

  await ddb.send(new PutCommand({
    TableName: MODEL_REGISTRY_TABLE,
    Item: item,
  }));

  return ok(200, {
    model_version: modelVersion,
    status: 'queued',
    message: 'Retrain request recorded',
    manifest_uri: body.manifest_uri,
    training_params: body.training_params || {},
  });
}

async function launchRetrainJob(modelVersion, body) {
  console.log('launchRetrainJob called', JSON.stringify({ modelVersion, body }));
  // Always fine-tune from the current production model unless explicitly overridden.
  const prodPointer = await getProdPointer();

  const getResp = await ddb.send(new GetCommand({
    TableName: MODEL_REGISTRY_TABLE,
    Key: { model_version: modelVersion },
  }));
  const existing = getResp.Item;

  if (!existing) {
    return ok(404, { error: 'Model not found' });
  }

  const datasetArchiveUri =
    body.dataset_archive_uri ||
    existing.training_params?.dataset_archive_uri ||
    `${DATASET_UPLOAD_PREFIX}/detectron2-coco-${modelVersion}.tar.gz`;
  const manifestUri = body.manifest_uri || existing.manifest_uri;
  const epochs = parseInt(body.epochs || existing.training_params?.epochs || '0', 10);
  const batchSize = parseInt(
    body.batch_size || existing.training_params?.batch_size || DEFAULT_BATCH_SIZE,
    10
  );
  const baseModelVersion =
    body.base_model_version || existing.base_model_version || prodPointer || null;
  if (!baseModelVersion) {
    return ok(400, { error: 'No production model set. Provide base_model_version or set prod pointer.' });
  }
  const maxIter = parseInt(
    body.max_iter || existing.training_params?.max_iter || computeMaxIter(epochs),
    10
  );
  const outputPrefixUri =
    body.output_prefix_uri || `s3://${OUTPUT_BUCKET}/model-registry/${modelVersion}`;
  const baseWeightsUri =
    body.base_weights_uri ||
    (baseModelVersion
      ? `s3://${OUTPUT_BUCKET}/${PROD_MODEL_PREFIX}/${baseModelVersion}/${baseModelVersion}/model_final.pth`
      : null);
  const datasetUploadUri = datasetArchiveUri;

  if (!datasetArchiveUri && !manifestUri) {
    return ok(400, { error: 'Provide a manifest_uri when dataset_archive_uri is omitted' });
  }
  if (!manifestUri && !existing.manifest_uri) {
    return ok(400, { error: 'manifest_uri missing; retrain record must include manifest' });
  }

  // Ensure required artifacts exist before we consume GPU
  if (datasetArchiveUri) {
    const parsed = parseS3Uri(datasetArchiveUri);
    if (!parsed) {
      return ok(400, { error: 'dataset_archive_uri must be an s3:// URI' });
    }
    try {
      await s3.send(new HeadObjectCommand({
        Bucket: parsed.bucket,
        Key: parsed.key,
      }));
    } catch (e) {
      return ok(400, {
        error:
          'Dataset archive not found yet. Let the COCO build finish before launching training.',
        dataset_archive_uri: datasetArchiveUri,
      });
    }
  }

  if (manifestUri) {
    const parsed = parseS3Uri(manifestUri);
    if (parsed) {
      try {
        await s3.send(new HeadObjectCommand({
          Bucket: parsed.bucket,
          Key: parsed.key,
        }));
      } catch (e) {
        return ok(400, { error: 'Manifest not found', manifest_uri: manifestUri });
      }
    }
  }

  // Validate base weights exist before consuming GPU
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

  const jobName = truncateJobName(`retrain-${modelVersion}`);

  const command = [
    '--output-prefix-uri',
    outputPrefixUri,
    '--batch-size',
    String(batchSize),
    '--max-iter',
    String(maxIter),
    '--checkpoint-epochs',
    String(DEFAULT_CHECKPOINT_EPOCHS),
    '--eval-epochs',
    String(DEFAULT_EVAL_EPOCHS),
    '--dataloader-workers',
    '2',
  ];

  if (datasetArchiveUri) {
    command.unshift('--dataset-archive-uri', datasetArchiveUri);
  } else {
    command.unshift('--manifest-uri', manifestUri, '--dataset-upload-uri', datasetUploadUri);
  }

  const submit = await batchClient.send(new SubmitJobCommand({
    jobName,
    jobQueue: RETRAIN_JOB_QUEUE,
    jobDefinition: RETRAIN_JOB_DEFINITION,
    containerOverrides: {
      command,
      environment: [
        { name: 'MANIFEST_URI', value: manifestUri },
        { name: 'OUTPUT_BUCKET', value: OUTPUT_BUCKET },
        { name: 'DATASET_UPLOAD_URI', value: datasetUploadUri },
        { name: 'RUN_NAME', value: modelVersion },
        ...(baseWeightsUri ? [{ name: 'BASE_WEIGHTS_URI', value: baseWeightsUri }] : []),
      ],
    },
  }));

  const now = Math.floor(Date.now() / 1000);
  await ddb.send(new UpdateCommand({
    TableName: MODEL_REGISTRY_TABLE,
    Key: { model_version: modelVersion },
    UpdateExpression:
      'SET #status = :status, batch_job_id = :jobId, batch_job_name = :jobName, training_params = :tp, manifest_uri = :manifest, updated_at = :now',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': 'submitted',
      ':jobId': submit.jobId,
      ':jobName': submit.jobName,
      ':tp': {
        ...(existing.training_params || {}),
        epochs: epochs || existing.training_params?.epochs || null,
        batch_size: batchSize,
        max_iter: maxIter,
        base_model_version: baseModelVersion || existing.base_model_version || null,
        base_weights_uri: baseWeightsUri || existing.training_params?.base_weights_uri || null,
        dataset_archive_uri:
          datasetArchiveUri || existing.training_params?.dataset_archive_uri || datasetUploadUri,
      },
      ':manifest': manifestUri,
      ':now': now,
    },
  }));

  // Mark all archives in this manifest as trained
  if (manifestUri) {
    await updateTrainedIndex(manifestUri, modelVersion);
  }

  return ok(200, {
    model_version: modelVersion,
    status: 'submitted',
    batch_job_id: submit.jobId,
    batch_job_name: submit.jobName,
    manifest_uri: manifestUri,
    max_iter: maxIter,
    epochs: epochs || null,
  });
}

function parseS3Uri(uri) {
  if (!uri || !uri.startsWith('s3://')) return null;
  const without = uri.replace('s3://', '');
  const firstSlash = without.indexOf('/');
  if (firstSlash === -1) return null;
  return { bucket: without.slice(0, firstSlash), key: without.slice(firstSlash + 1) };
}

const SKIP_PREFIXES = ['datasets/', 'model-registry/', 'detectron2-solar-models/', 'training-data/manifests/', 'el/', 'iv/', 'lambda-deployment/', 'models/'];

async function listAllMetadataKeys() {
  let continuationToken;
  const keys = [];

  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: TRAINING_DATA_BUCKET,
      ContinuationToken: continuationToken,
    }));

    for (const obj of resp.Contents || []) {
      if (!obj.Key || !obj.Key.endsWith('metadata.json')) continue;
      if (SKIP_PREFIXES.some((p) => obj.Key.startsWith(p))) continue;
      keys.push(obj.Key);
    }

    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

function computeMaxIter(epochs) {
  const e = parseInt(epochs || '0', 10);
  if (!e || Number.isNaN(e)) return 39050; // default ~100 epochs baseline
  // Original run: 781 train images, batch=2 => ~390 iters per epoch.
  return Math.max(500, Math.round(e * 390));
}

function truncateJobName(name) {
  if (name.length <= 118) return name;
  return name.slice(0, 118);
}

async function buildCocoArchive(body) {
  const manifestUri = body.manifest_uri;
  if (!manifestUri) {
    return ok(400, { error: 'manifest_uri is required to build a COCO archive' });
  }

  const targetUri =
    body.dataset_upload_uri ||
    `${DATASET_UPLOAD_PREFIX}/detectron2-coco-${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}.tar.gz`;

  const jobName = truncateJobName(`coco-build-${ulid().slice(0, 6)}`);

  const submit = await batchClient.send(new SubmitJobCommand({
    jobName,
    jobQueue: COCO_JOB_QUEUE,
    jobDefinition: COCO_JOB_DEFINITION,
    containerOverrides: {
      command: [
        '--manifest-uri',
        manifestUri,
        '--dataset-upload-uri',
        targetUri,
        '--build-only',
      ],
      environment: [
        { name: 'MANIFEST_URI', value: manifestUri },
        { name: 'OUTPUT_BUCKET', value: OUTPUT_BUCKET },
        { name: 'DATASET_UPLOAD_URI', value: targetUri },
        { name: 'DATASET_ARCHIVE_URI', value: '' },
        { name: 'BASE_WEIGHTS_URI', value: '' },
      ],
    },
  }));

  return ok(200, {
    message: 'COCO build job submitted',
    dataset_upload_uri: targetUri,
    batch_job_id: submit.jobId,
    batch_job_name: submit.jobName,
  });
}

async function prepareRetrain(body) {
  // 1) Generate manifest from archives
  const manifestResp = await createManifest();
  const manifest = safeParse(manifestResp.body);
  const manifestUri = manifest.manifest_uri;

  // 2) Queue coco build (build-only) on dedicated queue/definition
  const modelVersion = `model-${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}-${ulid().slice(0, 6)}`;
  const datasetUploadUri =
    `${DATASET_UPLOAD_PREFIX}/detectron2-coco-${modelVersion}.tar.gz`;

  const cocoJob = await batchClient.send(new SubmitJobCommand({
    jobName: truncateJobName(`coco-${modelVersion}`),
    jobQueue: COCO_JOB_QUEUE,
    jobDefinition: COCO_JOB_DEFINITION,
    containerOverrides: {
      command: [
        '--manifest-uri',
        manifestUri,
        '--dataset-upload-uri',
        datasetUploadUri,
        '--build-only',
      ],
      environment: [
        { name: 'MANIFEST_URI', value: manifestUri },
        { name: 'OUTPUT_BUCKET', value: OUTPUT_BUCKET },
        { name: 'DATASET_UPLOAD_URI', value: datasetUploadUri },
        { name: 'RUN_NAME', value: modelVersion },
        { name: 'DATASET_ARCHIVE_URI', value: '' },
        { name: 'BASE_WEIGHTS_URI', value: '' },
      ],
    },
  }));

  // 3) Create registry entry (status=queued, store manifest + dataset uri + params)
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

  await ddb.send(new PutCommand({
    TableName: MODEL_REGISTRY_TABLE,
    Item: item,
  }));

  return ok(200, {
    message: 'Prepare step submitted: manifest created, COCO build queued, registry entry created.',
    model_version: modelVersion,
    manifest_uri: manifestUri,
    dataset_archive_uri: datasetUploadUri,
    coco_job_id: cocoJob.jobId,
    coco_job_name: cocoJob.jobName,
  });
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

async function promoteModel(modelVersion, body) {
  const now = Math.floor(Date.now() / 1000);

  // Validate model exists before promoting
  const getResp = await ddb.send(new GetCommand({
    TableName: MODEL_REGISTRY_TABLE,
    Key: { model_version: modelVersion },
  }));
  if (!getResp.Item) {
    return ok(404, { error: 'Model not found in registry' });
  }

  // Get current production model to clear its is_production flag
  const currentProd = await getProdPointer();

  // Update pointer
  await ddb.send(new PutCommand({
    TableName: MODEL_REGISTRY_TABLE,
    Item: {
      model_version: PROD_POINTER_PK,
      current_production: modelVersion,
      updated_at: now,
      promoted_by: body?.promoted_by || 'admin',
    },
  }));

  // Clear is_production from previous model (if exists and different)
  if (currentProd && currentProd !== modelVersion) {
    await ddb.send(new UpdateCommand({
      TableName: MODEL_REGISTRY_TABLE,
      Key: { model_version: currentProd },
      UpdateExpression: 'SET is_production = :false, #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':false': false,
        ':status': 'archived',
      },
    }));
  }

  // Mark model as production
  await ddb.send(new UpdateCommand({
    TableName: MODEL_REGISTRY_TABLE,
    Key: { model_version: modelVersion },
    UpdateExpression:
      'SET is_production = :true, #status = :status, promoted_at = :ts, promoted_by = :by',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':true': true,
      ':status': 'production',
      ':ts': now,
      ':by': body?.promoted_by || 'admin',
    },
  }));

  // Auto-fetch metrics for promoted model if not already present
  if (!getResp.Item.metrics) {
    const metrics = await fetchMetricsForModel(modelVersion);
    if (metrics) {
      await ddb.send(new UpdateCommand({
        TableName: MODEL_REGISTRY_TABLE,
        Key: { model_version: modelVersion },
        UpdateExpression: 'SET metrics = :m',
        ExpressionAttributeValues: { ':m': metrics },
      }));
    }
  }

  return ok(200, {
    model_version: modelVersion,
    status: 'production',
    message: 'Model promoted',
  });
}

async function fetchMetricsForModel(modelVersion) {
  const key = `${PROD_MODEL_PREFIX}/${modelVersion}/${modelVersion}/final_results.json`;
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
    return {
      AP: round2(bbox.AP),
      AP50: round2(bbox.AP50),
      AP75: round2(bbox.AP75),
    };
  } catch (e) {
    console.error('fetchMetricsForModel: failed for', modelVersion, e.message);
    return null;
  }
}

async function syncMetrics() {
  const resp = await ddb.send(new ScanCommand({ TableName: MODEL_REGISTRY_TABLE, Limit: 200 }));
  const items = (resp.Items || []).filter(
    (item) => item.model_version && item.model_version !== PROD_POINTER_PK
  );

  let synced = 0;
  let skipped = 0;
  let failed = 0;

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
        TableName: MODEL_REGISTRY_TABLE,
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

async function deleteModel(modelVersion) {
  if (!modelVersion || modelVersion === PROD_POINTER_PK) {
    return ok(400, { error: 'Invalid model version' });
  }

  // Check if this is the current production model
  const getResp = await ddb.send(new GetCommand({
    TableName: MODEL_REGISTRY_TABLE,
    Key: { model_version: modelVersion },
  }));
  if (getResp.Item?.is_production) {
    return ok(400, { error: 'Cannot delete the current production model. Promote a different model first.' });
  }

  await ddb.send(new DeleteCommand({
    TableName: MODEL_REGISTRY_TABLE,
    Key: { model_version: modelVersion },
  }));

  return ok(200, { message: 'Model deleted', model_version: modelVersion });
}
