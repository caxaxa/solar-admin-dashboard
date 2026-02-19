/**
 * Tests for upload-presign Lambda function.
 *
 * Validates:
 * - Presigned URL generation
 * - File metadata recorded in DynamoDB
 * - Input validation (orgId, projectId, filename)
 * - Environment-based bucket selection
 * - OPTIONS preflight handling
 */

const mockPut = jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
const mockGetSignedUrl = jest.fn().mockReturnValue('https://s3.presigned.url/upload');

jest.mock('aws-sdk', () => ({
  config: { update: jest.fn() },
  S3: jest.fn().mockImplementation(() => ({
    getSignedUrl: mockGetSignedUrl,
  })),
  CognitoIdentityServiceProvider: jest.fn().mockImplementation(() => ({})),
  Batch: jest.fn().mockImplementation(() => ({})),
  DynamoDB: {
    DocumentClient: jest.fn().mockImplementation(() => ({
      put: mockPut,
    })),
  },
  StepFunctions: jest.fn().mockImplementation(() => ({})),
  SES: jest.fn().mockImplementation(() => ({})),
}));

process.env.PROJECTS_TABLE_DEV = 'test-projects-dev';
process.env.PROJECTS_TABLE_PROD = 'test-projects-prod';

const { handler } = require('../upload-presign/index');

function makeEvent(orgId, projectId, body = {}, env = 'dev', method = 'POST') {
  return {
    requestContext: { http: { method } },
    pathParameters: { orgId, projectId },
    queryStringParameters: { env },
    body: JSON.stringify(body),
  };
}

describe('upload-presign Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPut.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockGetSignedUrl.mockReturnValue('https://s3.presigned.url/upload');
  });

  describe('input validation', () => {
    test('returns 400 when orgId is missing', async () => {
      const result = await handler(makeEvent(undefined, 'proj-001', { filename: 'img.jpg' }));
      expect(result.statusCode).toBe(400);
    });

    test('returns 400 when projectId is missing', async () => {
      const result = await handler(makeEvent('org-001', undefined, { filename: 'img.jpg' }));
      expect(result.statusCode).toBe(400);
    });

    test('returns 400 when filename is missing', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', {}));
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('filename');
    });

    test('returns 405 for GET requests', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', {}, 'dev', 'GET'));
      expect(result.statusCode).toBe(405);
    });

    test('returns 204 for OPTIONS preflight', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', {}, 'dev', 'OPTIONS'));
      expect(result.statusCode).toBe(204);
    });
  });

  describe('presigned URL generation', () => {
    test('generates presigned URL and records file in DynamoDB', async () => {
      const result = await handler(
        makeEvent('org-001', 'proj-001', { filename: 'thermal_001.jpg', content_type: 'image/jpeg', file_size: 5000000 })
      );

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.upload_url).toBe('https://s3.presigned.url/upload');
      expect(body.file_id).toBeDefined();
      expect(body.project_id).toBe('proj-001');
      expect(body.s3_key).toBe('org-001/projects/proj-001/images/thermal_001.jpg');

      // Verify S3 presigned URL was generated with correct params
      expect(mockGetSignedUrl).toHaveBeenCalledWith('putObject', expect.objectContaining({
        Bucket: 'solar-uploads-dev',
        Key: 'org-001/projects/proj-001/images/thermal_001.jpg',
        ContentType: 'image/jpeg',
        Expires: 3600,
      }));

      // Verify DynamoDB put was called
      const putCall = mockPut.mock.calls[0][0];
      expect(putCall.TableName).toBe('test-projects-dev');
      expect(putCall.Item.PK).toBe('PROJECT#proj-001');
      expect(putCall.Item.SK).toMatch(/^FILE#/);
      expect(putCall.Item.filename).toBe('thermal_001.jpg');
      expect(putCall.Item.content_type).toBe('image/jpeg');
      expect(putCall.Item.size_bytes).toBe(5000000);
      expect(putCall.Item.upload_status).toBe('pending');
    });

    test('uses default content type when not provided', async () => {
      await handler(makeEvent('org-001', 'proj-001', { filename: 'file.bin' }));

      const putCall = mockPut.mock.calls[0][0];
      expect(putCall.Item.content_type).toBe('application/octet-stream');
    });

    test('uses prod bucket when env=prod', async () => {
      await handler(
        makeEvent('org-001', 'proj-001', { filename: 'img.jpg' }, 'prod')
      );

      expect(mockGetSignedUrl).toHaveBeenCalledWith('putObject', expect.objectContaining({
        Bucket: 'solar-uploads-prod',
      }));
    });
  });

  describe('error handling', () => {
    test('returns 500 when DynamoDB put fails', async () => {
      mockPut.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('DynamoDB write failed')),
      });

      const result = await handler(
        makeEvent('org-001', 'proj-001', { filename: 'img.jpg' })
      );
      expect(result.statusCode).toBe(500);
    });
  });
});
