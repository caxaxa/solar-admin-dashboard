/**
 * Tests for el-run-detections Lambda function.
 *
 * Covers both modes:
 *   - mock (default): random bbox generation with crack/microcrack labels
 *   - batch: real AWS Batch submission to solar-el-inference-{env}
 */

const mockListObjectsV2 = jest.fn();
const mockPutObject = jest.fn();
const mockSubmitJob = jest.fn();
const mockDynamoUpdate = jest.fn();

jest.mock('aws-sdk', () => ({
  config: { update: jest.fn() },
  S3: jest.fn().mockImplementation(() => ({
    listObjectsV2: mockListObjectsV2,
    putObject: mockPutObject,
  })),
  CognitoIdentityServiceProvider: jest.fn().mockImplementation(() => ({})),
  Batch: jest.fn().mockImplementation(() => ({
    submitJob: mockSubmitJob,
  })),
  DynamoDB: {
    DocumentClient: jest.fn().mockImplementation(() => ({
      update: mockDynamoUpdate,
    })),
  },
  StepFunctions: jest.fn().mockImplementation(() => ({})),
  SES: jest.fn().mockImplementation(() => ({})),
}));

process.env.EL_UPLOADS_BUCKET_DEV = 'solar-el-uploads-dev';
process.env.EL_UPLOADS_BUCKET_PROD = 'solar-el-uploads-prod';
process.env.EL_GROUNDTRUTH_BUCKET_DEV = 'solar-el-groundtruth-dev';
process.env.EL_GROUNDTRUTH_BUCKET_PROD = 'solar-el-groundtruth-prod';
process.env.EL_INFERENCE_JOB_DEF_DEV = 'solar-el-inference-dev';
process.env.JOB_QUEUE_DEV = 'solar-job-queue-dev';

const { handler } = require('../el-run-detections/index');

function makeEvent(orgId, projectId, env = 'dev', method = 'POST', extraQuery = {}) {
  return {
    requestContext: { http: { method } },
    pathParameters: { orgId, projectId },
    queryStringParameters: { env, ...extraQuery },
  };
}

describe('el-run-detections Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamoUpdate.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
  });

  describe('input validation', () => {
    test('returns 400 when orgId is missing', async () => {
      const result = await handler(makeEvent(undefined, 'proj-001'));
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('orgId');
    });

    test('returns 400 when projectId is missing', async () => {
      const result = await handler(makeEvent('org-001', undefined));
      expect(result.statusCode).toBe(400);
    });

    test('returns 405 for GET requests', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'dev', 'GET'));
      expect(result.statusCode).toBe(405);
    });

    test('returns 204 for OPTIONS preflight', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'dev', 'OPTIONS'));
      expect(result.statusCode).toBe(204);
    });
  });

  describe('mock mode', () => {
    beforeEach(() => {
      process.env.EL_INFERENCE_MODE = 'mock';
    });

    test('generates mock detections with crack/microcrack labels', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [
            { Key: 'org-001/projects/proj-001/images/panel_001.jpg' },
            { Key: 'org-001/projects/proj-001/images/panel_002.png' },
          ],
        }),
      });
      mockPutObject.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });

      const result = await handler(makeEvent('org-001', 'proj-001'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.mode).toBe('mock');
      expect(body.imageCount).toBe(2);

      const listCall = mockListObjectsV2.mock.calls[0][0];
      expect(listCall.Bucket).toBe('solar-el-uploads-dev');
      expect(listCall.Prefix).toBe('org-001/projects/proj-001/images/');

      const putCall = mockPutObject.mock.calls[0][0];
      expect(putCall.Bucket).toBe('solar-el-groundtruth-dev');
      expect(putCall.Key).toBe('org-001/projects/proj-001/detections.json');

      const detections = JSON.parse(putCall.Body);
      detections['panel_001.jpg'].forEach((box) => {
        expect(['crack', 'micro-crack', 'finger-interruption', 'dead-cell']).toContain(box.label);
        expect(box).toHaveProperty('left');
        expect(box).toHaveProperty('top');
        expect(box).toHaveProperty('width');
        expect(box).toHaveProperty('height');
      });
    });

    test('returns 400 when no images found', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Contents: [] }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('No images');
    });

    test('filters non-image files', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [
            { Key: 'org-001/projects/proj-001/images/panel.jpg' },
            { Key: 'org-001/projects/proj-001/images/metadata.json' },
            { Key: 'org-001/projects/proj-001/images/.DS_Store' },
          ],
        }),
      });
      mockPutObject.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).imageCount).toBe(1);
    });

    test('uses prod config when env=prod', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Contents: [{ Key: 'org/proj/images/img.jpg' }] }),
      });
      mockPutObject.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });

      await handler(makeEvent('org-001', 'proj-001', 'prod'));

      expect(mockListObjectsV2.mock.calls[0][0].Bucket).toBe('solar-el-uploads-prod');
      expect(mockPutObject.mock.calls[0][0].Bucket).toBe('solar-el-groundtruth-prod');
    });
  });

  describe('batch mode', () => {
    beforeEach(() => {
      process.env.EL_INFERENCE_MODE = 'batch';
    });

    test('submits Batch job with container overrides and returns 202 + jobId', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [{ Key: 'org-001/projects/proj-001/images/panel_001.jpg' }],
        }),
      });
      mockSubmitJob.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          jobId: 'job-abc-123',
          jobName: 'el-inference-proj-001-1700000000000',
        }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));

      expect(result.statusCode).toBe(202);
      const body = JSON.parse(result.body);
      expect(body.mode).toBe('batch');
      expect(body.jobId).toBe('job-abc-123');
      expect(body.imageCount).toBe(1);

      const submitCall = mockSubmitJob.mock.calls[0][0];
      expect(submitCall.jobDefinition).toBe('solar-el-inference-dev');
      expect(submitCall.jobQueue).toBe('solar-job-queue-dev');
      const envMap = Object.fromEntries(submitCall.containerOverrides.environment.map(e => [e.name, e.value]));
      expect(envMap.ORG_ID).toBe('org-001');
      expect(envMap.PROJECT_ID).toBe('proj-001');
      expect(envMap.EL_UPLOADS_BUCKET).toBe('solar-el-uploads-dev');
      expect(envMap.EL_GROUNDTRUTH_BUCKET).toBe('solar-el-groundtruth-dev');
    });

    test('returns 500 when Batch job definition missing', async () => {
      const saved = process.env.EL_INFERENCE_JOB_DEF_DEV;
      process.env.EL_INFERENCE_JOB_DEF_DEV = '';

      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [{ Key: 'org-001/projects/proj-001/images/panel_001.jpg' }],
        }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain('Batch job not configured');

      process.env.EL_INFERENCE_JOB_DEF_DEV = saved;
    });

    test('query param mode=mock overrides env var default of batch', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [{ Key: 'org-001/projects/proj-001/images/panel_001.jpg' }],
        }),
      });
      mockPutObject.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });

      const result = await handler(makeEvent('org-001', 'proj-001', 'dev', 'POST', { mode: 'mock' }));

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).mode).toBe('mock');
      expect(mockSubmitJob).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      process.env.EL_INFERENCE_MODE = 'mock';
    });

    test('returns 500 when bucket config is missing', async () => {
      const saved = process.env.EL_UPLOADS_BUCKET_DEV;
      process.env.EL_UPLOADS_BUCKET_DEV = '';

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(500);

      process.env.EL_UPLOADS_BUCKET_DEV = saved;
    });

    test('returns 500 when S3 list fails', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('Access Denied')),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(500);
    });
  });
});
