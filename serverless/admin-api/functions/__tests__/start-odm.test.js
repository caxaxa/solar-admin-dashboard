/**
 * Tests for start-odm Lambda function.
 *
 * Validates:
 * - Step Functions execution with correct parameters
 * - Manifest creation and upload to S3
 * - Instance type calculation based on dataset size
 * - Duplicate execution prevention
 * - DynamoDB status update
 * - Fallback environment lookup
 * - Error handling
 */

const mockGet = jest.fn();
const mockQuery = jest.fn();
const mockUpdate = jest.fn();
const mockPutObject = jest.fn();
const mockStartExecution = jest.fn();
const mockListExecutions = jest.fn();

jest.mock('aws-sdk', () => ({
  config: { update: jest.fn() },
  S3: jest.fn().mockImplementation(() => ({
    putObject: mockPutObject,
  })),
  CognitoIdentityServiceProvider: jest.fn().mockImplementation(() => ({})),
  Batch: jest.fn().mockImplementation(() => ({})),
  DynamoDB: {
    DocumentClient: jest.fn().mockImplementation(() => ({
      get: mockGet,
      query: mockQuery,
      update: mockUpdate,
    })),
  },
  StepFunctions: jest.fn().mockImplementation(() => ({
    startExecution: mockStartExecution,
    listExecutions: mockListExecutions,
  })),
  SES: jest.fn().mockImplementation(() => ({})),
}));

process.env.PROJECTS_TABLE_DEV = 'test-projects-dev';
process.env.PROJECTS_TABLE_PROD = 'test-projects-prod';

const { handler } = require('../start-odm/index');

function makeEvent(orgId, projectId, env = 'dev', method = 'POST') {
  return {
    requestContext: { http: { method } },
    pathParameters: { orgId, projectId },
    queryStringParameters: { env },
  };
}

const PROJECT_ITEM = {
  PK: 'PROJECT#proj-001',
  SK: 'METADATA',
  project_id: 'proj-001',
  user_id: 'user-001',
  tenant_id: 'tenant-001',
  status: 'uploading',
};

const COMPLETED_FILES = [
  { file_id: 'f1', filename: 'thermal_001.jpg', s3_key: 'org/proj/images/thermal_001.jpg', upload_status: 'completed', size_bytes: 5000000 },
  { file_id: 'f2', filename: 'thermal_002.jpg', s3_key: 'org/proj/images/thermal_002.jpg', upload_status: 'completed', size_bytes: 5000000 },
  { file_id: 'f3', filename: 'img_003.jpg', s3_key: 'org/proj/images/img_003.jpg', upload_status: 'pending', size_bytes: 3000000 },
];

describe('start-odm Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockReturnValue({ promise: jest.fn().mockResolvedValue({ Item: PROJECT_ITEM }) });
    mockQuery.mockReturnValue({ promise: jest.fn().mockResolvedValue({ Items: COMPLETED_FILES }) });
    mockUpdate.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockPutObject.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockStartExecution.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ executionArn: 'arn:aws:states:us-east-2:123:execution:test' }),
    });
    mockListExecutions.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ executions: [] }),
    });
  });

  describe('input validation', () => {
    test('returns 400 when orgId is missing', async () => {
      const result = await handler(makeEvent(undefined, 'proj-001'));
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

  describe('project lookup', () => {
    test('returns 404 when project not found', async () => {
      mockGet.mockReturnValue({ promise: jest.fn().mockResolvedValue({ Item: undefined }) });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(404);
    });

    test('falls back to other environment when project not found', async () => {
      // First call returns nothing, second call returns the project
      mockGet
        .mockReturnValueOnce({ promise: jest.fn().mockResolvedValue({ Item: undefined }) })
        .mockReturnValueOnce({ promise: jest.fn().mockResolvedValue({ Item: PROJECT_ITEM }) });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(200);
      // Should have tried both tables
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    test('returns 400 when no completed uploads', async () => {
      mockQuery.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Items: [{ upload_status: 'pending' }] }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('No completed uploads');
    });
  });

  describe('ODM execution', () => {
    test('starts Step Functions execution with correct parameters', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.status).toBe('processing');
      expect(body.executionArn).toBeDefined();
      expect(body.fileCount).toBe(2); // Only completed files
      expect(body.instanceType).toBeDefined();

      // Verify manifest was uploaded to S3
      expect(mockPutObject).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: 'solar-uploads-dev',
        Key: 'user-001/projects/proj-001/manifest.json',
        ContentType: 'application/json',
      }));

      // Verify DynamoDB was updated with processing status
      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.ExpressionAttributeValues[':status']).toBe('processing');
      expect(updateCall.ExpressionAttributeValues[':count']).toBe(2);
    });

    test('detects thermal images from filenames', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(200);

      // Files have "thermal" in their name, so image_type should be thermal
      const manifestBody = JSON.parse(mockPutObject.mock.calls[0][0].Body);
      expect(manifestBody.image_type).toBe('thermal');
    });

    test('detects RGB images when no thermal indicators', async () => {
      mockQuery.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Items: [
            { file_id: 'f1', filename: 'DJI_001.jpg', s3_key: 'k1', upload_status: 'completed', size_bytes: 5000000 },
            { file_id: 'f2', filename: 'DJI_002.jpg', s3_key: 'k2', upload_status: 'completed', size_bytes: 5000000 },
          ],
        }),
      });

      await handler(makeEvent('org-001', 'proj-001'));
      const manifestBody = JSON.parse(mockPutObject.mock.calls[0][0].Body);
      expect(manifestBody.image_type).toBe('rgb');
    });

    test('prevents duplicate execution', async () => {
      mockListExecutions.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          executions: [
            { name: 'project-proj-001-12345', executionArn: 'arn:existing' },
          ],
        }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe('already_processing');
      expect(mockStartExecution).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('returns 500 on Step Functions error', async () => {
      mockStartExecution.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('SFN quota')),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(500);
    });
  });
});
