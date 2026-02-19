/**
 * Tests for el-annotations Lambda function.
 *
 * Validates:
 * - GET: returns image URL, annotations, navigation info
 * - GET: falls back to detections.json when no human review exists
 * - PUT: saves per-image annotation
 * - Path parameter validation
 * - OPTIONS preflight handling
 */

const mockListObjectsV2 = jest.fn();
const mockGetObject = jest.fn();
const mockPutObject = jest.fn();
const mockGetSignedUrl = jest.fn().mockReturnValue('https://presigned-url.example.com');

jest.mock('aws-sdk', () => ({
  config: { update: jest.fn() },
  S3: jest.fn().mockImplementation(() => ({
    listObjectsV2: mockListObjectsV2,
    getObject: mockGetObject,
    putObject: mockPutObject,
    getSignedUrl: mockGetSignedUrl,
  })),
  CognitoIdentityServiceProvider: jest.fn().mockImplementation(() => ({})),
  Batch: jest.fn().mockImplementation(() => ({})),
  DynamoDB: { DocumentClient: jest.fn().mockImplementation(() => ({})) },
  StepFunctions: jest.fn().mockImplementation(() => ({})),
  SES: jest.fn().mockImplementation(() => ({})),
}));

process.env.EL_UPLOADS_BUCKET_DEV = 'solar-el-uploads-dev';
process.env.EL_GROUNDTRUTH_BUCKET_DEV = 'solar-el-groundtruth-dev';

const { handler } = require('../el-annotations/index');

function makeEvent(orgId, projectId, { method = 'GET', imageIndex = '0', body = null, env = 'dev' } = {}) {
  return {
    requestContext: { http: { method } },
    pathParameters: { orgId, projectId },
    queryStringParameters: { env, imageIndex },
    body: body ? JSON.stringify(body) : null,
  };
}

describe('el-annotations Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('input validation', () => {
    test('returns 400 when orgId is missing', async () => {
      const result = await handler(makeEvent(undefined, 'proj-001'));
      expect(result.statusCode).toBe(400);
    });

    test('returns 400 when projectId is missing', async () => {
      const result = await handler(makeEvent('org-001', undefined));
      expect(result.statusCode).toBe(400);
    });

    test('returns 204 for OPTIONS preflight', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', { method: 'OPTIONS' }));
      expect(result.statusCode).toBe(204);
    });
  });

  describe('GET - load annotations', () => {
    test('returns empty response when no images exist', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Contents: [] }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.totalImages).toBe(0);
      expect(body.imageUrl).toBeNull();
      expect(body.annotations.boundingBoxes).toEqual([]);
    });

    test('returns presigned URL and annotations for image', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [
            { Key: 'org-001/projects/proj-001/images/panel_001.jpg' },
            { Key: 'org-001/projects/proj-001/images/panel_002.jpg' },
          ],
        }),
      });

      // Human-reviewed annotation exists
      mockGetObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: JSON.stringify({
            boundingBoxes: [{ left: 10, top: 20, width: 50, height: 60, label: 'defects' }],
            reviewedAt: '2025-01-01T00:00:00Z',
          }),
        }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.totalImages).toBe(2);
      expect(body.currentIndex).toBe(0);
      expect(body.filename).toBe('panel_001.jpg');
      expect(body.imageUrl).toBe('https://presigned-url.example.com');
      expect(body.annotations.boundingBoxes).toHaveLength(1);
    });

    test('falls back to detections.json when no human review', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [{ Key: 'org-001/projects/proj-001/images/panel.jpg' }],
        }),
      });

      // No human annotation
      mockGetObject
        .mockReturnValueOnce({
          promise: jest.fn().mockRejectedValue({ code: 'NoSuchKey' }),
        })
        // detections.json
        .mockReturnValueOnce({
          promise: jest.fn().mockResolvedValue({
            Body: JSON.stringify({
              'panel.jpg': [{ left: 5, top: 10, width: 30, height: 40, label: 'defects' }],
            }),
          }),
        });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.annotations.boundingBoxes).toHaveLength(1);
      expect(body.annotations.boundingBoxes[0].left).toBe(5);
    });

    test('clamps imageIndex to valid range', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [
            { Key: 'org-001/projects/proj-001/images/a.jpg' },
            { Key: 'org-001/projects/proj-001/images/b.jpg' },
          ],
        }),
      });

      // No annotations
      mockGetObject.mockReturnValue({
        promise: jest.fn().mockRejectedValue({ code: 'NoSuchKey' }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001', { imageIndex: '999' }));
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.currentIndex).toBe(1); // clamped to last index
    });
  });

  describe('PUT - save annotations', () => {
    test('saves per-image annotation', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [{ Key: 'org-001/projects/proj-001/images/panel.jpg' }],
        }),
      });

      mockPutObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({}),
      });

      const result = await handler(makeEvent('org-001', 'proj-001', {
        method: 'PUT',
        body: {
          boundingBoxes: [
            { left: 10, top: 20, width: 50, height: 60, label: 'defects' },
          ],
        },
      }));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain('1 annotations');

      // Verify annotation saved to correct S3 path
      const putCall = mockPutObject.mock.calls[0][0];
      expect(putCall.Bucket).toBe('solar-el-groundtruth-dev');
      expect(putCall.Key).toBe('org-001/projects/proj-001/annotations/panel.jpg.json');
    });

    test('returns 400 when body is missing boundingBoxes', async () => {
      const result = await handler(makeEvent('org-001', 'proj-001', {
        method: 'PUT',
        body: { something: 'else' },
      }));
      expect(result.statusCode).toBe(400);
    });

    test('returns 400 when no images found', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Contents: [] }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001', {
        method: 'PUT',
        body: { boundingBoxes: [] },
      }));
      expect(result.statusCode).toBe(400);
    });
  });
});
