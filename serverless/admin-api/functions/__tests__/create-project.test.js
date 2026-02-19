/**
 * Tests for create-project Lambda function.
 *
 * Validates:
 * - Project creation in DynamoDB with correct schema
 * - Input validation (userId, projectName required)
 * - Environment normalization (dev/prod)
 * - OPTIONS preflight handling
 * - Error handling (duplicate project, DynamoDB failure)
 * - Email notification (non-blocking on failure)
 */

// Mock aws-sdk before requiring handler
const mockPut = jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
const mockListUsers = jest.fn().mockReturnValue({
  promise: jest.fn().mockResolvedValue({ Users: [] }),
});
const mockListUsersInGroup = jest.fn().mockReturnValue({
  promise: jest.fn().mockResolvedValue({ Users: [] }),
});

jest.mock('aws-sdk', () => ({
  config: { update: jest.fn() },
  S3: jest.fn().mockImplementation(() => ({})),
  CognitoIdentityServiceProvider: jest.fn().mockImplementation(() => ({
    listUsers: mockListUsers,
    listUsersInGroup: mockListUsersInGroup,
  })),
  Batch: jest.fn().mockImplementation(() => ({})),
  DynamoDB: {
    DocumentClient: jest.fn().mockImplementation(() => ({
      put: mockPut,
    })),
  },
  StepFunctions: jest.fn().mockImplementation(() => ({})),
  SES: jest.fn().mockImplementation(() => ({
    sendEmail: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) }),
  })),
}));

// Mock send-email to avoid SES dependency
jest.mock('../send-email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
}));

// Set required env vars before importing handler
process.env.PROJECTS_TABLE_DEV = 'test-projects-dev';
process.env.PROJECTS_TABLE_PROD = 'test-projects-prod';
process.env.COGNITO_USER_POOL_ID = 'us-east-1_TestPool';

const { handler } = require('../create-project/index');

function makeEvent(body, method = 'POST') {
  return {
    requestContext: { http: { method } },
    body: JSON.stringify(body),
  };
}

describe('create-project Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPut.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
  });

  describe('input validation', () => {
    test('returns 400 when userId is missing', async () => {
      const result = await handler(makeEvent({ projectName: 'Test' }));
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('userId');
    });

    test('returns 400 when projectName is missing', async () => {
      const result = await handler(makeEvent({ userId: 'user-001' }));
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('projectName');
    });
  });

  describe('project creation', () => {
    test('creates project with correct DynamoDB item structure', async () => {
      const result = await handler(
        makeEvent({ userId: 'user-001', projectName: 'Solar Farm A' })
      );

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.projectName).toBe('Solar Farm A');
      expect(body.userId).toBe('user-001');
      expect(body.projectId).toBeDefined();

      // Verify DynamoDB put was called with correct item
      const putCall = mockPut.mock.calls[0][0];
      expect(putCall.TableName).toBe('test-projects-dev');
      expect(putCall.Item.PK).toMatch(/^PROJECT#/);
      expect(putCall.Item.SK).toBe('METADATA');
      expect(putCall.Item.project_name).toBe('Solar Farm A');
      expect(putCall.Item.user_id).toBe('user-001');
      expect(putCall.Item.status).toBe('creating');
      expect(putCall.Item.file_count).toBe(0);
      expect(putCall.Item.GSI1PK).toBe('USER#user-001');
      expect(putCall.ConditionExpression).toBe('attribute_not_exists(PK)');
    });

    test('uses prod table when environment is prod', async () => {
      const result = await handler(
        makeEvent({ userId: 'user-001', projectName: 'Test', environment: 'prod' })
      );

      expect(result.statusCode).toBe(200);
      const putCall = mockPut.mock.calls[0][0];
      expect(putCall.TableName).toBe('test-projects-prod');
    });

    test('normalizes unknown environment to dev', async () => {
      const result = await handler(
        makeEvent({ userId: 'user-001', projectName: 'Test', environment: 'staging' })
      );

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).environment).toBe('dev');
    });

    test('includes description when provided', async () => {
      await handler(
        makeEvent({
          userId: 'user-001',
          projectName: 'Test',
          description: 'A test project',
        })
      );

      const putCall = mockPut.mock.calls[0][0];
      expect(putCall.Item.description).toBe('A test project');
    });

    test('sets empty description when not provided', async () => {
      await handler(makeEvent({ userId: 'user-001', projectName: 'Test' }));
      const putCall = mockPut.mock.calls[0][0];
      expect(putCall.Item.description).toBe('');
    });
  });

  describe('error handling', () => {
    test('returns 409 on ConditionalCheckFailedException', async () => {
      const error = new Error('Condition not met');
      error.code = 'ConditionalCheckFailedException';
      mockPut.mockReturnValue({ promise: jest.fn().mockRejectedValue(error) });

      const result = await handler(
        makeEvent({ userId: 'user-001', projectName: 'Duplicate' })
      );

      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).error).toContain('already exists');
    });

    test('returns 500 on DynamoDB error', async () => {
      mockPut.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('DynamoDB timeout')),
      });

      const result = await handler(
        makeEvent({ userId: 'user-001', projectName: 'Test' })
      );

      expect(result.statusCode).toBe(500);
    });

    test('succeeds even when email notification fails', async () => {
      const { sendEmail } = require('../send-email');
      sendEmail.mockRejectedValueOnce(new Error('SES quota exceeded'));

      const result = await handler(
        makeEvent({ userId: 'user-001', projectName: 'Test' })
      );

      // Should still return success
      expect(result.statusCode).toBe(200);
    });
  });

  describe('OPTIONS preflight', () => {
    test('returns 204 for OPTIONS request', async () => {
      const result = await handler(makeEvent({}, 'OPTIONS'));
      expect(result.statusCode).toBe(204);
    });
  });

  describe('email notification', () => {
    test('looks up user email from Cognito', async () => {
      mockListUsers.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Users: [{ Attributes: [{ Name: 'email', Value: 'user@example.com' }] }],
        }),
      });

      await handler(makeEvent({ userId: 'user-001', projectName: 'Test' }));

      expect(mockListUsers).toHaveBeenCalled();
    });

    test('looks up admin group for notification', async () => {
      await handler(makeEvent({ userId: 'user-001', projectName: 'Test' }));
      expect(mockListUsersInGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          GroupName: 'admin',
        })
      );
    });
  });
});
