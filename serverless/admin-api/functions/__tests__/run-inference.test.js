/**
 * Tests for run-inference Lambda function.
 *
 * Validates:
 * - Batch job submission with correct parameters
 * - Path parameter validation (orgId, projectId)
 * - Environment-based bucket/job configuration
 * - OPTIONS preflight handling
 * - Error handling (missing config, Batch failure)
 */

const mockSubmitJob = jest.fn().mockReturnValue({
  promise: jest.fn().mockResolvedValue({ jobId: 'job-123', jobName: 'inference-test' }),
});

jest.mock('aws-sdk', () => ({
  config: { update: jest.fn() },
  S3: jest.fn().mockImplementation(() => ({})),
  CognitoIdentityServiceProvider: jest.fn().mockImplementation(() => ({})),
  Batch: jest.fn().mockImplementation(() => ({
    submitJob: mockSubmitJob,
  })),
  DynamoDB: { DocumentClient: jest.fn().mockImplementation(() => ({})) },
  StepFunctions: jest.fn().mockImplementation(() => ({})),
  SES: jest.fn().mockImplementation(() => ({})),
}));

process.env.JOB_QUEUE_DEV = 'test-queue-dev';
process.env.JOB_QUEUE_PROD = 'test-queue-prod';
process.env.INFERENCE_JOB_DEF_DEV = 'inference-def-dev';
process.env.INFERENCE_JOB_DEF_PROD = 'inference-def-prod';

const { handler } = require('../run-inference/index');

function makeEvent(orgId, projectId, env = 'dev', method = 'POST') {
  return {
    requestContext: { http: { method } },
    pathParameters: { orgId, projectId },
    queryStringParameters: { env },
  };
}

describe('run-inference Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubmitJob.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ jobId: 'job-123', jobName: 'inference-test' }),
    });
  });

  describe('input validation', () => {
    test('returns 400 when orgId is missing', async () => {
      const event = makeEvent(undefined, 'proj-001');
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('orgId');
    });

    test('returns 400 when projectId is missing', async () => {
      const event = makeEvent('org-001', undefined);
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    test('returns 405 for GET requests', async () => {
      const event = makeEvent('org-001', 'proj-001', 'dev', 'GET');
      const result = await handler(event);
      expect(result.statusCode).toBe(405);
    });

    test('returns 204 for OPTIONS preflight', async () => {
      const event = makeEvent('org-001', 'proj-001', 'dev', 'OPTIONS');
      const result = await handler(event);
      expect(result.statusCode).toBe(204);
    });
  });

  describe('job submission', () => {
    test('submits Batch job with correct parameters', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.jobId).toBe('job-123');

      const submitCall = mockSubmitJob.mock.calls[0][0];
      expect(submitCall.jobQueue).toBe('test-queue-dev');
      expect(submitCall.jobDefinition).toBe('inference-def-dev');
      expect(submitCall.jobName).toMatch(/^inference-proj-001-/);

      const envVars = submitCall.containerOverrides.environment;
      const getEnv = (name) => envVars.find(e => e.name === name)?.value;
      expect(getEnv('ORG_ID')).toBe('org-001');
      expect(getEnv('PROJECT_ID')).toBe('proj-001');
      expect(getEnv('SOLAR_PROJECT_ID')).toBe('proj-001');
      expect(getEnv('SOLAR_ORTHOPHOTO_KEY')).toBe('org-001/projects/proj-001/odm_orthophoto.tif');
      expect(getEnv('ENVIRONMENT')).toBe('dev');
    });

    test('uses prod config when env=prod', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'prod'));

      expect(result.statusCode).toBe(200);
      const submitCall = mockSubmitJob.mock.calls[0][0];
      expect(submitCall.jobQueue).toBe('test-queue-prod');
      expect(submitCall.jobDefinition).toBe('inference-def-prod');

      const envVars = submitCall.containerOverrides.environment;
      const getEnv = (name) => envVars.find(e => e.name === name)?.value;
      expect(getEnv('SOLAR_ORTHOS_BUCKET')).toBe('solar-orthos-prod');
      expect(getEnv('SOLAR_REPORTS_BUCKET')).toBe('solar-reports-prod');
    });
  });

  describe('error handling', () => {
    test('returns 500 when Batch submission fails', async () => {
      mockSubmitJob.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('Batch quota exceeded')),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(500);
    });

    test('returns 500 when job config is missing', async () => {
      const savedQueue = process.env.JOB_QUEUE_DEV;
      process.env.JOB_QUEUE_DEV = '';

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain('configuration');

      process.env.JOB_QUEUE_DEV = savedQueue;
    });
  });
});
