/**
 * EL Project Actions — generate-report, release, release-error, delete.
 *
 * POST /el/projects/{orgId}/{projectId}/actions/{action}
 *   action = generate-report | release | release-error | delete
 */
const { batch, s3, dynamodb } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
const { normalizeEnv, getELBucketConfig, getELJobResources } = require('../shared/env');
const { writeJson } = require('../shared/s3-utils');

const TRAINING_BUCKET = 'solar-ai-training';

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
    action: params.action,
  };
}

async function deleteAllWithPrefix(bucket, prefix) {
  if (!bucket || !prefix) return;
  let continuationToken;
  do {
    const result = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
      .promise();

    const objects = (result.Contents || []).map((obj) => ({ Key: obj.Key }));
    if (objects.length > 0) {
      await s3
        .deleteObjects({ Bucket: bucket, Delete: { Objects: objects } })
        .promise();
    }
    continuationToken = result.NextContinuationToken;
  } while (continuationToken);
}

exports.handler = async (event) => {
  setRequestEvent(event);
  const method = (event.requestContext?.http?.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return preflightResponse();
  if (method !== 'POST') return errorResponse(405, 'Method not allowed');

  try {
    const { orgId, projectId, action } = getPathParams(event);
    if (!orgId || !projectId || !action) {
      return errorResponse(400, 'Missing orgId, projectId, or action');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const releaseMode = event.queryStringParameters?.release_mode;
    const { uploadsBucket, groundtruthBucket, reportsBucket } = getELBucketConfig(env);

    switch (action) {
      case 'generate-report': {
        const { jobQueue, reportJobDefinition } = getELJobResources(env);
        if (!jobQueue || !reportJobDefinition) {
          return errorResponse(500, 'EL Batch configuration missing');
        }

        const response = await batch
          .submitJob({
            jobName: `el-report-${projectId}-${Date.now()}`,
            jobQueue,
            jobDefinition: reportJobDefinition,
            containerOverrides: {
              environment: [
                { name: 'ORG_ID', value: orgId },
                { name: 'PROJECT_ID', value: projectId },
                { name: 'SOLAR_PROJECT_ID', value: projectId },
                { name: 'SOLAR_USER_ID', value: orgId },
                { name: 'ENVIRONMENT', value: env },
                { name: 'EL_UPLOADS_BUCKET', value: uploadsBucket },
                { name: 'EL_GROUNDTRUTH_BUCKET', value: groundtruthBucket },
                { name: 'EL_REPORTS_BUCKET', value: reportsBucket },
              ],
            },
          })
          .promise();

        return jsonResponse(200, {
          success: true,
          jobId: response.jobId,
          jobName: response.jobName,
        });
      }

      case 'release': {
        const isFree = releaseMode === 'free';
        const projectPrefix = `${orgId}/projects/${projectId}`;

        // Archive annotations + images to training bucket
        const archivePrefix = `el/${orgId}/${projectId}/`;
        const metadata = {
          orgId,
          projectId,
          releasedAt: new Date().toISOString(),
          releaseMode: isFree ? 'free' : 'paywall',
          type: 'el',
        };
        await writeJson(TRAINING_BUCKET, `${archivePrefix}metadata.json`, metadata);

        // Update DynamoDB project status
        const projectsTable = `solar-projects-${env}`;
        try {
          await dynamodb
            .update({
              TableName: projectsTable,
              Key: { PK: `PROJECT#${projectId}`, SK: 'METADATA' },
              UpdateExpression: 'SET is_released = :r, release_mode = :m, released_at = :t',
              ExpressionAttributeValues: {
                ':r': true,
                ':m': isFree ? 'free' : 'paywall',
                ':t': new Date().toISOString(),
              },
            })
            .promise();
        } catch (err) {
          console.warn('DynamoDB update failed (non-critical):', err.message);
        }

        return jsonResponse(200, {
          success: true,
          message: isFree ? 'Released for free' : 'Released with paywall',
        });
      }

      case 'release-error': {
        // Mark project as having a release error
        const projectsTable = `solar-projects-${env}`;
        try {
          await dynamodb
            .update({
              TableName: projectsTable,
              Key: { PK: `PROJECT#${projectId}`, SK: 'METADATA' },
              UpdateExpression: 'SET #status = :s, status_message = :m',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':s': 'release_error',
                ':m': 'Released with error flag',
              },
            })
            .promise();
        } catch (err) {
          console.warn('DynamoDB update failed (non-critical):', err.message);
        }

        return jsonResponse(200, { success: true, message: 'Released with error' });
      }

      case 'complete-review': {
        await writeJson(
          groundtruthBucket,
          `${orgId}/projects/${projectId}/review-complete.json`,
          { completedAt: new Date().toISOString(), orgId, projectId }
        );
        return jsonResponse(200, { success: true, message: 'Review marked complete' });
      }

      case 'delete': {
        const projectPrefix = `${orgId}/projects/${projectId}/`;

        // Delete from all 3 EL buckets
        await Promise.all([
          deleteAllWithPrefix(uploadsBucket, projectPrefix),
          deleteAllWithPrefix(groundtruthBucket, projectPrefix),
          deleteAllWithPrefix(reportsBucket, projectPrefix),
        ]);

        // Delete DynamoDB record
        const projectsTable = `solar-projects-${env}`;
        try {
          await dynamodb
            .delete({
              TableName: projectsTable,
              Key: { PK: `PROJECT#${projectId}`, SK: 'METADATA' },
            })
            .promise();
        } catch (err) {
          console.warn('DynamoDB delete failed (non-critical):', err.message);
        }

        return jsonResponse(200, { success: true, message: 'EL project deleted' });
      }

      default:
        return errorResponse(400, `Unknown action: ${action}`);
    }
  } catch (error) {
    console.error('EL project action failed', error);
    return errorResponse(500, 'EL project action failed');
  }
};
