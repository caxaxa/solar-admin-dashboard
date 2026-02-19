/**
 * Tests for el-project-actions Lambda function.
 *
 * Validates:
 * - generate-report: submits Batch job
 * - release: archives to training bucket, updates DynamoDB
 * - release-error: marks project with error flag
 * - delete: removes from all EL buckets + DynamoDB
 * - Path parameter validation
 * - Unknown action handling
 */

const mockSubmitJob = jest.fn();
const mockListObjectsV2 = jest.fn();
const mockDeleteObjects = jest.fn();
const mockPutObject = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('aws-sdk', () => ({
  config: { update: jest.fn() },
  S3: jest.fn().mockImplementation(() => ({
    listObjectsV2: mockListObjectsV2,
    deleteObjects: mockDeleteObjects,
    putObject: mockPutObject,
  })),
  CognitoIdentityServiceProvider: jest.fn().mockImplementation(() => ({})),
  Batch: jest.fn().mockImplementation(() => ({
    submitJob: mockSubmitJob,
  })),
  DynamoDB: {
    DocumentClient: jest.fn().mockImplementation(() => ({
      update: mockUpdate,
      delete: mockDelete,
    })),
  },
  StepFunctions: jest.fn().mockImplementation(() => ({})),
  SES: jest.fn().mockImplementation(() => ({})),
}));

process.env.EL_UPLOADS_BUCKET_DEV = 'solar-el-uploads-dev';
process.env.EL_GROUNDTRUTH_BUCKET_DEV = 'solar-el-groundtruth-dev';
process.env.EL_REPORTS_BUCKET_DEV = 'solar-el-reports-dev';
process.env.JOB_QUEUE_DEV = 'test-queue-dev';
process.env.EL_REPORT_JOB_DEF_DEV = 'el-report-def-dev';
process.env.PROJECTS_TABLE_DEV = 'solar-projects-dev';

const { handler } = require('../el-project-actions/index');

function makeEvent(orgId, projectId, action, { method = 'POST', env = 'dev', releaseMode } = {}) {
  const qs = { env };
  if (releaseMode) qs.release_mode = releaseMode;
  return {
    requestContext: { http: { method } },
    pathParameters: { orgId, projectId, action },
    queryStringParameters: qs,
  };
}

describe('el-project-actions Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubmitJob.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ jobId: 'job-001', jobName: 'el-report-test' }),
    });
    mockUpdate.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockDelete.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockPutObject.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockListObjectsV2.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Contents: [] }),
    });
    mockDeleteObjects.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
  });

  describe('input validation', () => {
    test('returns 400 when orgId is missing', async () => {
      const result = await handler(makeEvent(undefined, 'proj-001', 'release'));
      expect(result.statusCode).toBe(400);
    });

    test('returns 400 for unknown action', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'unknown'));
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('Unknown action');
    });

    test('returns 405 for GET requests', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'release', { method: 'GET' }));
      expect(result.statusCode).toBe(405);
    });

    test('returns 204 for OPTIONS preflight', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'release', { method: 'OPTIONS' }));
      expect(result.statusCode).toBe(204);
    });
  });

  describe('generate-report action', () => {
    test('submits Batch job with correct parameters', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'generate-report'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.jobId).toBe('job-001');

      const submitCall = mockSubmitJob.mock.calls[0][0];
      expect(submitCall.jobQueue).toBe('test-queue-dev');
      expect(submitCall.jobDefinition).toBe('el-report-def-dev');
      expect(submitCall.jobName).toMatch(/^el-report-proj-001/);
    });

    test('returns 500 when Batch config is missing', async () => {
      const savedQueue = process.env.JOB_QUEUE_DEV;
      process.env.JOB_QUEUE_DEV = '';

      const result = await handler(makeEvent('org-001', 'proj-001', 'generate-report'));
      expect(result.statusCode).toBe(500);

      process.env.JOB_QUEUE_DEV = savedQueue;
    });
  });

  describe('release action', () => {
    test('archives metadata and updates DynamoDB (paywall mode)', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'release'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('paywall');

      // Verify metadata written to training bucket
      const putCall = mockPutObject.mock.calls[0][0];
      expect(putCall.Bucket).toBe('solar-ai-training');
      expect(putCall.Key).toBe('el/org-001/proj-001/metadata.json');
      const metadata = JSON.parse(putCall.Body);
      expect(metadata.releaseMode).toBe('paywall');
      expect(metadata.type).toBe('el');

      // Verify DynamoDB update
      expect(mockUpdate).toHaveBeenCalled();
      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.Key.PK).toBe('PROJECT#proj-001');
    });

    test('sets free mode when release_mode=free', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'release', { releaseMode: 'free' }));

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toContain('free');

      const metadata = JSON.parse(mockPutObject.mock.calls[0][0].Body);
      expect(metadata.releaseMode).toBe('free');
    });
  });

  describe('release-error action', () => {
    test('marks project with error flag in DynamoDB', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'release-error'));

      expect(result.statusCode).toBe(200);
      expect(mockUpdate).toHaveBeenCalled();

      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.ExpressionAttributeValues[':s']).toBe('release_error');
    });
  });

  describe('delete action', () => {
    test('deletes from all EL buckets and DynamoDB', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'delete'));

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toContain('deleted');

      // Should list objects from all 3 EL buckets
      expect(mockListObjectsV2).toHaveBeenCalledTimes(3);

      // Should delete DynamoDB record
      expect(mockDelete).toHaveBeenCalled();
      const deleteCall = mockDelete.mock.calls[0][0];
      expect(deleteCall.Key.PK).toBe('PROJECT#proj-001');
    });
  });
});
