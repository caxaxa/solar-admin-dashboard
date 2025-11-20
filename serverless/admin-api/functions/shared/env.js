const DEFAULT_ENV = 'dev';

function normalizeEnv(value) {
  const env = (value || DEFAULT_ENV).toLowerCase();
  return env === 'prod' ? 'prod' : DEFAULT_ENV;
}

function getBucketConfig(env) {
  const normalized = normalizeEnv(env);
  return {
    env: normalized,
    groundtruthBucket:
      process.env[`GROUNDTRUTH_BUCKET_${normalized.toUpperCase()}`] || '',
    orthosBucket:
      process.env[`ORTHOS_BUCKET_${normalized.toUpperCase()}`] || '',
    reportsBucket:
      process.env[`REPORTS_BUCKET_${normalized.toUpperCase()}`] || '',
  };
}

function getProjectsTable(env) {
  const normalized = normalizeEnv(env);
  return process.env[`PROJECTS_TABLE_${normalized.toUpperCase()}`] || '';
}

function getJobResources(env) {
  const normalized = normalizeEnv(env);
  return {
    jobQueue: process.env[`JOB_QUEUE_${normalized.toUpperCase()}`] || '',
    inferenceJobDefinition:
      process.env[`INFERENCE_JOB_DEF_${normalized.toUpperCase()}`] || '',
    reportJobDefinition:
      process.env[`REPORT_JOB_DEF_${normalized.toUpperCase()}`] || '',
  };
}

module.exports = {
  normalizeEnv,
  getBucketConfig,
  getProjectsTable,
  getJobResources,
};
