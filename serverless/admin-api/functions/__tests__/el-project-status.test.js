/**
 * Tests for el-project-status Lambda function.
 *
 * Validates:
 * - Checks all 5 EL pipeline artifacts
 * - Returns presigned URL for report PDF when available
 * - Path parameter validation
 * - OPTIONS preflight handling
 */

const mockListObjectsV2 = jest.fn();
const mockHeadObject = jest.fn();
const mockGetSignedUrl = jest.fn().mockReturnValue('https://presigned-report.example.com');
const mockDynamoGet = jest.fn();
const mockDynamoUpdate = jest.fn();
const mockDescribeJobs = jest.fn();

jest.mock('aws-sdk', () => ({
  config: { update: jest.fn() },
  S3: jest.fn().mockImplementation(() => ({
    listObjectsV2: mockListObjectsV2,
    headObject: mockHeadObject,
    getSignedUrl: mockGetSignedUrl,
  })),
  CognitoIdentityServiceProvider: jest.fn().mockImplementation(() => ({})),
  Batch: jest.fn().mockImplementation(() => ({
    describeJobs: mockDescribeJobs,
  })),
  DynamoDB: {
    DocumentClient: jest.fn().mockImplementation(() => ({
      get: mockDynamoGet,
      update: mockDynamoUpdate,
    })),
  },
  StepFunctions: jest.fn().mockImplementation(() => ({})),
  SES: jest.fn().mockImplementation(() => ({})),
}));

process.env.EL_UPLOADS_BUCKET_DEV = 'solar-el-uploads-dev';
process.env.EL_GROUNDTRUTH_BUCKET_DEV = 'solar-el-groundtruth-dev';
process.env.EL_REPORTS_BUCKET_DEV = 'solar-el-reports-dev';

const { handler } = require('../el-project-status/index');

function makeEvent(orgId, projectId, { method = 'GET', env = 'dev' } = {}) {
  return {
    requestContext: { http: { method } },
    pathParameters: { orgId, projectId },
    queryStringParameters: { env },
  };
}

describe('el-project-status Lambda', () => {
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

  describe('status checks', () => {
    test('returns all false when project has no artifacts', async () => {
      // No images
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Contents: [] }),
      });
      // No detections, review, report, or training metadata
      mockHeadObject.mockReturnValue({
        promise: jest.fn().mockRejectedValue({ code: 'NotFound' }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.hasImages).toBe(false);
      expect(body.hasDetections).toBe(false);
      expect(body.hasHumanReview).toBe(false);
      expect(body.hasReport).toBe(false);
      expect(body.isReleased).toBe(false);
      expect(body.reportFullUrl).toBeNull();
    });

    test('returns correct status when all artifacts exist', async () => {
      // Has images
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [{ Key: 'org-001/projects/proj-001/images/panel.jpg' }],
        }),
      });
      // All artifacts exist
      mockHeadObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({}),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.hasImages).toBe(true);
      expect(body.hasDetections).toBe(true);
      expect(body.hasHumanReview).toBe(true);
      expect(body.hasReport).toBe(true);
      expect(body.isReleased).toBe(true);
      expect(body.reportFullUrl).toBe('https://presigned-report.example.com');
    });

    test('returns null detectionJob when no PROJECTS_TABLE configured', async () => {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Contents: [] }),
      });
      mockHeadObject.mockReturnValue({
        promise: jest.fn().mockRejectedValue({ code: 'NotFound' }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      const body = JSON.parse(result.body);
      expect(body.detectionJob).toBeNull();
      expect(mockDynamoGet).not.toHaveBeenCalled();
      expect(mockDescribeJobs).not.toHaveBeenCalled();
    });
  });

  describe('detection job polling', () => {
    const savedTable = process.env.PROJECTS_TABLE_DEV;
    beforeAll(() => {
      process.env.PROJECTS_TABLE_DEV = 'solar-projects-dev';
    });
    afterAll(() => {
      if (savedTable) process.env.PROJECTS_TABLE_DEV = savedTable;
      else delete process.env.PROJECTS_TABLE_DEV;
    });

    function stubEmptyArtifacts() {
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Contents: [] }),
      });
      mockHeadObject.mockReturnValue({
        promise: jest.fn().mockRejectedValue({ code: 'NotFound' }),
      });
    }

    test('returns live Batch status when detection job is RUNNING', async () => {
      stubEmptyArtifacts();
      mockDynamoGet.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Item: {
            stages: {
              detection: {
                mode: 'batch',
                status: 'detecting',
                job_id: 'job-abc-123',
                job_name: 'el-inference-proj-001',
                submitted_at: '2026-04-24T10:00:00Z',
              },
            },
          },
        }),
      });
      mockDescribeJobs.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          jobs: [{ jobId: 'job-abc-123', jobName: 'el-inference-proj-001', status: 'RUNNING' }],
        }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      const body = JSON.parse(result.body);

      expect(body.detectionJob.jobId).toBe('job-abc-123');
      expect(body.detectionJob.status).toBe('RUNNING');
      expect(body.detectionJob.mode).toBe('batch');
      expect(mockDynamoUpdate).not.toHaveBeenCalled(); // non-terminal → no writeback
    });

    test('persists terminal SUCCEEDED status back to DynamoDB', async () => {
      stubEmptyArtifacts();
      mockDynamoGet.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Item: {
            stages: {
              detection: { mode: 'batch', status: 'detecting', job_id: 'job-done' },
            },
          },
        }),
      });
      mockDescribeJobs.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          jobs: [{ jobId: 'job-done', status: 'SUCCEEDED' }],
        }),
      });
      mockDynamoUpdate.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      const body = JSON.parse(result.body);

      expect(body.detectionJob.status).toBe('SUCCEEDED');
      expect(mockDynamoUpdate).toHaveBeenCalledTimes(1);
      const updateCall = mockDynamoUpdate.mock.calls[0][0];
      expect(updateCall.ExpressionAttributeValues[':s']).toBe('detecting_complete');
      expect(updateCall.ExpressionAttributeValues[':d'].batch_status).toBe('SUCCEEDED');
    });

    test('short-circuits when stage already records terminal batch_status', async () => {
      stubEmptyArtifacts();
      mockDynamoGet.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Item: {
            stages: {
              detection: {
                mode: 'batch',
                status: 'detecting_failed',
                job_id: 'job-failed',
                batch_status: 'FAILED',
                status_reason: 'out of memory',
              },
            },
          },
        }),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      const body = JSON.parse(result.body);

      expect(body.detectionJob.status).toBe('FAILED');
      expect(body.detectionJob.statusReason).toBe('out of memory');
      expect(mockDescribeJobs).not.toHaveBeenCalled();
    });

    test('falls through gracefully when DynamoDB read fails', async () => {
      stubEmptyArtifacts();
      mockDynamoGet.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('Table not found')),
      });

      const result = await handler(makeEvent('org-001', 'proj-001'));
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).detectionJob).toBeNull();
    });
  });

  describe('partial status', () => {
    test('returns partial status correctly', async () => {
      // Has images
      mockListObjectsV2.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Contents: [{ Key: 'img.jpg' }],
        }),
      });

      // detections.json exists, but review and report don't
      mockHeadObject
        .mockReturnValueOnce({ promise: jest.fn().mockResolvedValue({}) }) // detections
        .mockReturnValueOnce({ promise: jest.fn().mockRejectedValue({ code: 'NotFound' }) }) // review
        .mockReturnValueOnce({ promise: jest.fn().mockRejectedValue({ code: 'NotFound' }) }) // report
        .mockReturnValueOnce({ promise: jest.fn().mockRejectedValue({ code: 'NotFound' }) }); // training

      const result = await handler(makeEvent('org-001', 'proj-001'));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.hasImages).toBe(true);
      expect(body.hasDetections).toBe(true);
      expect(body.hasHumanReview).toBe(false);
      expect(body.hasReport).toBe(false);
      expect(body.isReleased).toBe(false);
    });
  });
});
