/**
 * Tests for el-run-detections Lambda function.
 *
 * Validates:
 * - Mock model generates random bounding boxes per image
 * - S3 list images and write detections
 * - Path parameter validation (orgId, projectId)
 * - OPTIONS preflight handling
 * - Error handling (missing config, no images)
 */

const mockListObjectsV2 = jest.fn();
const mockPutObject = jest.fn();

jest.mock('aws-sdk', () => ({
  config: { update: jest.fn() },
  S3: jest.fn().mockImplementation(() => ({
    listObjectsV2: mockListObjectsV2,
    putObject: mockPutObject,
  })),
  CognitoIdentityServiceProvider: jest.fn().mockImplementation(() => ({})),
  Batch: jest.fn().mockImplementation(() => ({})),
  DynamoDB: { DocumentClient: jest.fn().mockImplementation(() => ({})) },
  StepFunctions: jest.fn().mockImplementation(() => ({})),
  SES: jest.fn().mockImplementation(() => ({})),
}));

process.env.EL_UPLOADS_BUCKET_DEV = 'solar-el-uploads-dev';
process.env.EL_UPLOADS_BUCKET_PROD = 'solar-el-uploads-prod';
process.env.EL_GROUNDTRUTH_BUCKET_DEV = 'solar-el-groundtruth-dev';
process.env.EL_GROUNDTRUTH_BUCKET_PROD = 'solar-el-groundtruth-prod';

const { handler } = require('../el-run-detections/index');

function makeEvent(orgId, projectId, env = 'dev', method = 'POST') {
  return {
    requestContext: { http: { method } },
    pathParameters: { orgId, projectId },
    queryStringParameters: { env },
  };
}

describe('el-run-detections Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  describe('detection generation', () => {
    test('generates mock detections for each image', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [
            { Key: 'org-001/projects/proj-001/images/panel_001.jpg' },
            { Key: 'org-001/projects/proj-001/images/panel_002.png' },
          ],
        }),
      });

      mockPutObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({}),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.imageCount).toBe(2);
      expect(body.totalDetections).toBeGreaterThanOrEqual(2);
      expect(body.totalDetections).toBeLessThanOrEqual(10);

      // Verify S3 listObjectsV2 called with correct prefix
      const listCall = mockListObjectsV2.mock.calls[0][0];
      expect(listCall.Bucket).toBe('solar-el-uploads-dev');
      expect(listCall.Prefix).toBe('org-001/projects/proj-001/images/');

      // Verify detections written to groundtruth bucket
      const putCall = mockPutObject.mock.calls[0][0];
      expect(putCall.Bucket).toBe('solar-el-groundtruth-dev');
      expect(putCall.Key).toBe('org-001/projects/proj-001/detections.json');

      const detections = JSON.parse(putCall.Body);
      expect('panel_001.jpg' in detections).toBe(true);
      expect('panel_002.png' in detections).toBe(true);
      expect(Array.isArray(detections['panel_001.jpg'])).toBe(true);

      // Each box should have label "defects"
      detections['panel_001.jpg'].forEach((box) => {
        expect(box.label).toBe('defects');
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

      mockPutObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({}),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).imageCount).toBe(1);
    });

    test('uses prod config when env=prod', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [{ Key: 'org/proj/images/img.jpg' }],
        }),
      });
      mockPutObject.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });

      await handler(makeEvent('org-001', 'proj-001', 'prod'));

      expect(mockListObjectsV2.mock.calls[0][0].Bucket).toBe('solar-el-uploads-prod');
      expect(mockPutObject.mock.calls[0][0].Bucket).toBe('solar-el-groundtruth-prod');
    });
  });

  describe('error handling', () => {
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
