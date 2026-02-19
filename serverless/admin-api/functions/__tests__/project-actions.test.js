/**
 * Tests for project-actions Lambda function.
 *
 * Validates all 5 action types:
 * - generate-report: Batch job submission
 * - release: S3 copy to training bucket + DynamoDB update
 * - delete: S3 deletion + DynamoDB record removal
 * - release-error: DynamoDB status update with error
 * - recompile-tex: Batch job with SOLAR_COMPILE_ONLY=true
 */

const mockSubmitJob = jest.fn();
const mockGet = jest.fn();
const mockQuery = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockHeadObject = jest.fn();
const mockCopyObject = jest.fn();
const mockPutObject = jest.fn();
const mockListObjectsV2 = jest.fn();
const mockDeleteObjects = jest.fn();
const mockListUsers = jest.fn();
const mockListUsersInGroup = jest.fn();

jest.mock('aws-sdk', () => ({
  config: { update: jest.fn() },
  S3: jest.fn().mockImplementation(() => ({
    headObject: mockHeadObject,
    copyObject: mockCopyObject,
    putObject: mockPutObject,
    listObjectsV2: mockListObjectsV2,
    deleteObjects: mockDeleteObjects,
  })),
  CognitoIdentityServiceProvider: jest.fn().mockImplementation(() => ({
    listUsers: mockListUsers,
    listUsersInGroup: mockListUsersInGroup,
  })),
  Batch: jest.fn().mockImplementation(() => ({
    submitJob: mockSubmitJob,
  })),
  DynamoDB: {
    DocumentClient: jest.fn().mockImplementation(() => ({
      get: mockGet,
      query: mockQuery,
      update: mockUpdate,
      delete: mockDelete,
    })),
  },
  StepFunctions: jest.fn().mockImplementation(() => ({})),
  SES: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../send-email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
}));

process.env.PROJECTS_TABLE_DEV = 'test-projects-dev';
process.env.PROJECTS_TABLE_PROD = 'test-projects-prod';
process.env.JOB_QUEUE_DEV = 'test-queue-dev';
process.env.REPORT_JOB_DEF_DEV = 'report-def-dev';
process.env.COGNITO_USER_POOL_ID = 'us-east-1_TestPool';

const { handler } = require('../project-actions/index');

function makeEvent(orgId, projectId, actionType, env = 'dev', method = 'POST', queryExtra = {}) {
  return {
    requestContext: { http: { method } },
    pathParameters: { orgId, projectId, actionType },
    queryStringParameters: { env, ...queryExtra },
  };
}

const PROJECT_ITEM = {
  PK: 'PROJECT#proj-001',
  SK: 'METADATA',
  project_id: 'proj-001',
  project_name: 'Test Solar Farm',
  user_id: 'user-001',
  status: 'creating',
  stages: {},
};

describe('project-actions Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockReturnValue({ promise: jest.fn().mockResolvedValue({ Item: PROJECT_ITEM }) });
    mockQuery.mockReturnValue({ promise: jest.fn().mockResolvedValue({ Items: [] }) });
    mockUpdate.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockDelete.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockSubmitJob.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ jobId: 'job-123', jobName: 'report-test' }),
    });
    mockHeadObject.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockCopyObject.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockPutObject.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockListObjectsV2.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Contents: [], IsTruncated: false }),
    });
    mockDeleteObjects.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockListUsers.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Users: [] }),
    });
    mockListUsersInGroup.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Users: [] }),
    });
  });

  describe('input validation', () => {
    test('returns 400 when path parameters missing', async () => {
      const event = {
        requestContext: { http: { method: 'POST' } },
        pathParameters: {},
        queryStringParameters: { env: 'dev' },
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    test('returns 400 for unknown action type', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'unknown-action'));
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('Unknown action');
    });

    test('returns 204 for OPTIONS preflight', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'generate-report', 'dev', 'OPTIONS'));
      expect(result.statusCode).toBe(204);
    });

    test('returns 405 for non-POST methods', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'generate-report', 'dev', 'GET'));
      expect(result.statusCode).toBe(405);
    });
  });

  describe('generate-report action', () => {
    test('submits Batch job with correct environment variables', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'generate-report'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.jobId).toBe('job-123');

      const submitCall = mockSubmitJob.mock.calls[0][0];
      expect(submitCall.jobQueue).toBe('test-queue-dev');
      expect(submitCall.jobDefinition).toBe('report-def-dev');

      const envVars = submitCall.containerOverrides.environment;
      const getEnv = (name) => envVars.find(e => e.name === name)?.value;
      expect(getEnv('SOLAR_USER_ID')).toBe('org-001');
      expect(getEnv('SOLAR_PROJECT_ID')).toBe('proj-001');
      expect(getEnv('SOLAR_AREA_NAME')).toBe('Test Solar Farm');
    });

    test('returns 500 when job config is missing', async () => {
      const savedQueue = process.env.JOB_QUEUE_DEV;
      process.env.JOB_QUEUE_DEV = '';

      const result = await handler(makeEvent('org-001', 'proj-001', 'generate-report'));
      expect(result.statusCode).toBe(500);

      process.env.JOB_QUEUE_DEV = savedQueue;
    });
  });

  describe('release action', () => {
    test('copies files to training bucket and updates DynamoDB', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'release'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.training_data_archived).toBe(true);
      expect(body.release_mode).toBe('paywall');
      expect(body.paywall_bypass).toBe(false);

      // Verify S3 headObject + copyObject were called for both files
      expect(mockHeadObject).toHaveBeenCalledTimes(2);
      expect(mockCopyObject).toHaveBeenCalledTimes(2);

      // Verify metadata.json was written
      expect(mockPutObject).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: 'solar-ai-training',
        Key: 'org-001/proj-001/metadata.json',
      }));

      // Verify DynamoDB update
      expect(mockUpdate).toHaveBeenCalled();
      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.ExpressionAttributeValues[':released']).toBe(true);
      expect(updateCall.ExpressionAttributeValues[':release_mode']).toBe('paywall');
    });

    test('supports free release mode', async () => {
      const result = await handler(
        makeEvent('org-001', 'proj-001', 'release', 'dev', 'POST', { release_mode: 'free' })
      );

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.release_mode).toBe('free');
      expect(body.paywall_bypass).toBe(true);
    });

    test('skips missing orthophoto gracefully', async () => {
      const notFoundError = new Error('Not found');
      notFoundError.code = 'NotFound';
      mockHeadObject
        .mockReturnValueOnce({ promise: jest.fn().mockRejectedValue(notFoundError) })
        .mockReturnValueOnce({ promise: jest.fn().mockResolvedValue({}) });

      const result = await handler(makeEvent('org-001', 'proj-001', 'release'));
      expect(result.statusCode).toBe(200);
      // Only one copy call (for labels, not orthophoto)
      expect(mockCopyObject).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete action', () => {
    test('deletes S3 files and DynamoDB records', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [{ Key: 'f1' }, { Key: 'f2' }],
          IsTruncated: false,
        }),
      });
      mockQuery.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Items: [
            { PK: 'PROJECT#proj-001', SK: 'METADATA' },
            { PK: 'PROJECT#proj-001', SK: 'FILE#f1' },
          ],
        }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001', 'delete'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.deletedFiles).toBe(2);
      expect(body.deletedRecords).toBe(2);
    });

    test('rejects deletion of processed projects', async () => {
      mockGet.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Item: { ...PROJECT_ITEM, status: 'completed' },
        }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001', 'delete'));
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain('completed');
    });
  });

  describe('release-error action', () => {
    test('updates DynamoDB with error status', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'release-error'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);

      // Verify DynamoDB update sets FAILED status
      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.ExpressionAttributeValues[':status']).toBe('error');
    });
  });

  describe('recompile-tex action', () => {
    test('submits Batch job with SOLAR_COMPILE_ONLY=true', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', 'recompile-tex'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain('TeX recompilation');

      const submitCall = mockSubmitJob.mock.calls[0][0];
      const envVars = submitCall.containerOverrides.environment;
      const getEnv = (name) => envVars.find(e => e.name === name)?.value;
      expect(getEnv('SOLAR_COMPILE_ONLY')).toBe('true');
    });
  });
});
