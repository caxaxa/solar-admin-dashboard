/**
 * EL Project Actions — generate-report, release, release-error, delete.
 *
 * POST /el/projects/{orgId}/{projectId}/actions/{action}
 *   action = generate-report | release | release-error | delete | complete-review
 */
const { batch, s3, dynamodb, cognito } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
const { normalizeEnv, getELBucketConfig, getELJobResources } = require('../shared/env');
const { writeJson } = require('../shared/s3-utils');
const { sendEmail } = require('../send-email');

const TRAINING_BUCKET = 'solar-ai-training';

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
    action: params.action,
  };
}

function looksLikeEmail(value) {
  return typeof value === 'string' && value.includes('@');
}

async function findUserByFilter(userPoolId, filter) {
  const response = await cognito.listUsers({
    UserPoolId: userPoolId,
    Filter: filter,
    Limit: 1,
  }).promise();

  if (response.Users && response.Users.length > 0) {
    return response.Users[0];
  }
  return null;
}

/**
 * Get user email from Cognito by user ID (sub) or username/email fallback.
 */
async function getUserEmail(userId) {
  try {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    if (!userPoolId || !userId) return null;

    if (looksLikeEmail(userId)) {
      return userId;
    }

    const filters = [
      `sub = "${userId}"`,
      `username = "${userId}"`,
      `email = "${userId}"`,
    ];

    for (const filter of filters) {
      let user = null;
      try {
        user = await findUserByFilter(userPoolId, filter);
      } catch (err) {
        console.warn('User lookup failed for filter', { filter, error: err.message });
        continue;
      }

      if (user) {
        const emailAttr = user.Attributes?.find(attr => attr.Name === 'email');
        if (emailAttr?.Value) {
          return emailAttr.Value;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Failed to get user email', error);
    return null;
  }
}

/**
 * Get all admin emails from Cognito admin group
 */
async function getAdminEmails() {
  try {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    if (!userPoolId) return [];

    const response = await cognito.listUsersInGroup({
      UserPoolId: userPoolId,
      GroupName: 'admin',
      Limit: 60,
    }).promise();

    const emails = [];
    for (const user of response.Users || []) {
      const emailAttr = user.Attributes?.find(attr => attr.Name === 'email');
      if (emailAttr?.Value) {
        emails.push(emailAttr.Value);
      }
    }
    return emails;
  } catch (error) {
    console.error('Failed to get admin emails', error);
    return [];
  }
}

/**
 * Get project details from DynamoDB
 */
async function getProjectDetails(projectId, env) {
  const projectsTable = `solar-projects-${env}`;
  const result = await dynamodb.get({
    TableName: projectsTable,
    Key: {
      PK: `PROJECT#${projectId}`,
      SK: 'METADATA',
    },
  }).promise();
  return result.Item;
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

/**
 * Copy all objects under a source prefix to a destination prefix in another bucket.
 */
async function copyAllWithPrefix(sourceBucket, sourcePrefix, destBucket, destPrefix) {
  const copied = [];
  let continuationToken;
  do {
    const result = await s3.listObjectsV2({
      Bucket: sourceBucket,
      Prefix: sourcePrefix,
      ContinuationToken: continuationToken,
    }).promise();

    for (const obj of result.Contents || []) {
      const relativePath = obj.Key.slice(sourcePrefix.length);
      const destKey = `${destPrefix}${relativePath}`;
      await s3.copyObject({
        Bucket: destBucket,
        Key: destKey,
        CopySource: `${sourceBucket}/${obj.Key}`,
      }).promise();
      copied.push(`s3://${destBucket}/${destKey}`);
    }
    continuationToken = result.NextContinuationToken;
  } while (continuationToken);
  return copied;
}

/**
 * Handle EL project release — archive training data + update DynamoDB.
 * Matches the thermographic handleRelease() pattern exactly.
 */
async function handleRelease(orgId, projectId, env, releaseMode = 'paywall') {
  const { uploadsBucket, groundtruthBucket } = getELBucketConfig(env);
  const normalizedReleaseMode = releaseMode === 'free' ? 'free' : 'paywall';
  const paywallBypass = normalizedReleaseMode === 'free';

  const imagesPrefix = `${orgId}/projects/${projectId}/images/`;
  const annotationsPrefix = `${orgId}/projects/${projectId}/annotations/`;

  const timestamp = new Date().toISOString();
  const trainingPrefix = `el/${orgId}/${projectId}`;

  const archivedFiles = [];

  // Copy all EL images to training bucket
  try {
    const imagesCopied = await copyAllWithPrefix(
      uploadsBucket,
      imagesPrefix,
      TRAINING_BUCKET,
      `${trainingPrefix}/images/`
    );
    archivedFiles.push(...imagesCopied);
    console.log(`Copied ${imagesCopied.length} images to training bucket`);
  } catch (err) {
    console.error('Failed to copy images to training bucket:', err.message);
  }

  // Copy all annotation files to training bucket
  try {
    const annotationsCopied = await copyAllWithPrefix(
      groundtruthBucket,
      annotationsPrefix,
      TRAINING_BUCKET,
      `${trainingPrefix}/annotations/`
    );
    archivedFiles.push(...annotationsCopied);
    console.log(`Copied ${annotationsCopied.length} annotation files to training bucket`);
  } catch (err) {
    console.error('Failed to copy annotations to training bucket:', err.message);
  }

  // Create metadata.json to mark as released
  const metadata = {
    org_id: orgId,
    project_id: projectId,
    environment: env,
    release_mode: normalizedReleaseMode,
    paywall_bypass: paywallBypass,
    released_at: timestamp,
    type: 'el',
    source_files: {
      images: `s3://${uploadsBucket}/${imagesPrefix}`,
      annotations: `s3://${groundtruthBucket}/${annotationsPrefix}`,
    },
    archived_files: archivedFiles,
  };

  await s3.putObject({
    Bucket: TRAINING_BUCKET,
    Key: `${trainingPrefix}/metadata.json`,
    Body: JSON.stringify(metadata, null, 2),
    ContentType: 'application/json',
  }).promise();
  archivedFiles.push(`s3://${TRAINING_BUCKET}/${trainingPrefix}/metadata.json`);

  const projectsTable = `solar-projects-${env}`;
  const timestampEpoch = Math.floor(Date.now() / 1000);

  // Merge existing stages (older projects might not have a map here)
  const existingProject = await getProjectDetails(projectId, env);
  const existingStages = (existingProject && typeof existingProject.stages === 'object') ? existingProject.stages : {};
  const mergedStages = {
    ...existingStages,
    el_report: {
      status: 'COMPLETED',
      released_at: timestampEpoch,
    },
  };

  // Update DynamoDB — all 5 attributes matching thermographic pattern
  await dynamodb.update({
    TableName: projectsTable,
    Key: {
      PK: `PROJECT#${projectId}`,
      SK: 'METADATA',
    },
    UpdateExpression: 'SET released_at = :released_at, is_released = :released, stages = :stages, release_mode = :release_mode, paywall_bypass = :paywall_bypass',
    ExpressionAttributeValues: {
      ':released_at': timestampEpoch,
      ':released': true,
      ':stages': mergedStages,
      ':release_mode': normalizedReleaseMode,
      ':paywall_bypass': paywallBypass,
    },
  }).promise();
  console.log('Updated DynamoDB with released_at and el_report.status:', timestampEpoch);

  return {
    success: true,
    message: paywallBypass ? 'Project released for free (paywall bypass enabled)' : 'Project released successfully',
    training_data_archived: true,
    archived_files: archivedFiles,
    release_mode: normalizedReleaseMode,
    paywall_bypass: paywallBypass,
    released_at: timestamp,
  };
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
    const { uploadsBucket, groundtruthBucket, reportsBucket } = getELBucketConfig(env);

    switch (action) {
      case 'generate-report': {
        const { jobQueue, reportJobDefinition } = getELJobResources(env);
        if (!jobQueue || !reportJobDefinition) {
          return errorResponse(500, 'EL Batch configuration missing');
        }

        // Get project details for report metadata
        const project = await getProjectDetails(projectId, env);
        const projectName = project?.project_name || 'Solar Farm';

        // Get user email for client name in report
        let userEmail = '';
        if (project?.user_id) {
          userEmail = await getUserEmail(project.user_id) || '';
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
                { name: 'SOLAR_AREA_NAME', value: projectName },
                { name: 'SOLAR_CLIENT_NAME', value: userEmail },
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
        const releaseModeRaw = String(event.queryStringParameters?.release_mode || 'paywall').toLowerCase();
        const releaseMode = releaseModeRaw === 'free' ? 'free' : 'paywall';
        const result = await handleRelease(orgId, projectId, env, releaseMode);

        // Send email notification to user and admins on release
        const project = await getProjectDetails(projectId, env);
        const userEmail = project?.user_id ? await getUserEmail(project.user_id) : null;
        const adminEmails = await getAdminEmails();

        const allRecipients = [...new Set([userEmail, ...adminEmails].filter(Boolean))];

        if (allRecipients.length > 0) {
          try {
            const emailResult = await sendEmail(allRecipients, 'elProjectReleased', {
              projectId,
              projectName: project?.project_name || projectId,
            });
            console.log('Release email result:', emailResult);
          } catch (err) {
            console.error('Release email notification failed', err);
          }
        } else {
          console.log('No recipients found for release notification');
        }

        return jsonResponse(200, result);
      }

      case 'release-error': {
        // Mark project as released with error status in DynamoDB
        const projectsTable = `solar-projects-${env}`;
        const timestampEpoch = Math.floor(Date.now() / 1000);

        // Merge existing stages safely
        const existingProject = await getProjectDetails(projectId, env);
        const existingStages = (existingProject && typeof existingProject.stages === 'object') ? existingProject.stages : {};
        const mergedStages = {
          ...existingStages,
          el_report: {
            status: 'FAILED',
            released_at: timestampEpoch,
            error: true,
          },
        };

        await dynamodb.update({
          TableName: projectsTable,
          Key: {
            PK: `PROJECT#${projectId}`,
            SK: 'METADATA',
          },
          UpdateExpression: 'SET released_at = :released_at, is_released = :released, release_status = :status, stages = :stages',
          ExpressionAttributeValues: {
            ':released_at': timestampEpoch,
            ':released': true,
            ':status': 'error',
            ':stages': mergedStages,
          },
        }).promise();

        // Send error notification email to user and admins
        const project = await getProjectDetails(projectId, env);
        const userEmail = project?.user_id ? await getUserEmail(project.user_id) : null;
        const adminEmails = await getAdminEmails();

        const allRecipients = [...new Set([userEmail, ...adminEmails].filter(Boolean))];

        if (allRecipients.length > 0) {
          try {
            const emailResult = await sendEmail(allRecipients, 'elProjectReleasedWithError', {
              projectId,
              projectName: project?.project_name || projectId,
            });
            console.log('Release error email result:', emailResult);
          } catch (err) {
            console.error('Release error email notification failed', err);
          }
        }

        return jsonResponse(200, {
          success: true,
          message: 'Project released with error notification sent',
          released_at: new Date(timestampEpoch * 1000).toISOString(),
        });
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
    return errorResponse(500, error.message || 'EL project action failed');
  }
};
