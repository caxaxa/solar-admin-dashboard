const { batch, s3, dynamodb, cognito } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getJobResources } = require('../shared/env');
const { sendEmail } = require('../send-email');

const TRAINING_BUCKET = 'solar-ai-training';

/**
 * Get user email from Cognito by user ID (sub)
 */
async function getUserEmail(userId) {
  try {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    if (!userPoolId) return null;

    const response = await cognito.listUsers({
      UserPoolId: userPoolId,
      Filter: `sub = "${userId}"`,
      Limit: 1,
    }).promise();

    if (response.Users && response.Users.length > 0) {
      const emailAttr = response.Users[0].Attributes?.find(attr => attr.Name === 'email');
      return emailAttr?.Value || null;
    }
    return null;
  } catch (error) {
    console.error('Failed to get user email', error);
    return null;
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

async function handleRelease(orgId, projectId, env) {
  const orthosBucket = `solar-orthos-${env}`;
  const groundtruthBucket = `solar-groundtruth-${env}`;

  const tifKey = `${orgId}/projects/${projectId}/odm_orthophoto/odm_orthophoto_1.6cm.tif`;
  const labelsKey = `${orgId}/projects/${projectId}/groundtruth/defect_labels.json`;

  const timestamp = new Date().toISOString();
  // Use a fixed prefix so we can check for release status by listing
  const trainingPrefix = `${orgId}/${projectId}`;

  const archivedFiles = [];

  // Copy cropped TIF to training bucket
  try {
    await s3.headObject({ Bucket: orthosBucket, Key: tifKey }).promise();
    await s3.copyObject({
      Bucket: TRAINING_BUCKET,
      Key: `${trainingPrefix}/odm_orthophoto_1.6cm.tif`,
      CopySource: `${orthosBucket}/${tifKey}`,
    }).promise();
    archivedFiles.push(`s3://${TRAINING_BUCKET}/${trainingPrefix}/odm_orthophoto_1.6cm.tif`);
    console.log('Copied TIF to training bucket');
  } catch (err) {
    if (err.code === 'NotFound') {
      console.log('Cropped TIF not found, skipping');
    } else {
      throw err;
    }
  }

  // Copy defect labels to training bucket
  try {
    await s3.headObject({ Bucket: groundtruthBucket, Key: labelsKey }).promise();
    await s3.copyObject({
      Bucket: TRAINING_BUCKET,
      Key: `${trainingPrefix}/defect_labels.json`,
      CopySource: `${groundtruthBucket}/${labelsKey}`,
    }).promise();
    archivedFiles.push(`s3://${TRAINING_BUCKET}/${trainingPrefix}/defect_labels.json`);
    console.log('Copied labels to training bucket');
  } catch (err) {
    if (err.code === 'NotFound') {
      console.log('Defect labels not found, skipping');
    } else {
      throw err;
    }
  }

  // Create metadata.json to mark as released
  const metadata = {
    org_id: orgId,
    project_id: projectId,
    environment: env,
    released_at: timestamp,
    source_files: {
      orthophoto: `s3://${orthosBucket}/${tifKey}`,
      labels: `s3://${groundtruthBucket}/${labelsKey}`,
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

  // Update DynamoDB to mark project as released
  // Note: We set the entire stages.thermo_report object because it may not exist yet
  const projectsTable = `solar-projects-${env}`;
  const timestampEpoch = Math.floor(Date.now() / 1000);
  await dynamodb.update({
    TableName: projectsTable,
    Key: {
      PK: `PROJECT#${projectId}`,
      SK: 'METADATA'
    },
    UpdateExpression: 'SET released_at = :released_at, is_released = :released, stages.thermo_report = :thermo_report',
    ExpressionAttributeValues: {
      ':released_at': timestampEpoch,
      ':released': true,
      ':thermo_report': {
        status: 'COMPLETED',
        released_at: timestampEpoch
      }
    }
  }).promise();
  console.log('Updated DynamoDB with released_at and thermo_report.status:', timestampEpoch);

  return {
    success: true,
    message: 'Project released successfully',
    training_data_archived: true,
    archived_files: archivedFiles,
    released_at: timestamp,
  };
}

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
    actionType: params.actionType,
  };
}

exports.handler = async (event) => {
  const method = (event.requestContext?.http?.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return preflightResponse();
  }
  if (method !== 'POST') {
    return errorResponse(405, 'Method not allowed');
  }

  try {
    const { orgId, projectId, actionType } = getPathParams(event);
    if (!orgId || !projectId || !actionType) {
      return errorResponse(400, 'Missing path parameters');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const { jobQueue, reportJobDefinition } = getJobResources(env);

    if (actionType === 'generate-report') {
      if (!jobQueue || !reportJobDefinition) {
        return errorResponse(500, 'Report job configuration missing');
      }

      const response = await batch
        .submitJob({
          jobName: `report-${projectId}-${Date.now()}`,
          jobQueue,
          jobDefinition: reportJobDefinition,
          containerOverrides: {
            environment: [
              { name: 'ORG_ID', value: orgId },
              { name: 'PROJECT_ID', value: projectId },
              { name: 'ENVIRONMENT', value: env },
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

    if (actionType === 'release') {
      const result = await handleRelease(orgId, projectId, env);

      // Send email notification to user on release
      const project = await getProjectDetails(projectId, env);
      if (project && project.user_id) {
        const userEmail = await getUserEmail(project.user_id);
        if (userEmail) {
          sendEmail(userEmail, 'projectReleased', {
            projectId,
            projectName: project.project_name || projectId,
          }).catch(err => console.error('Release email notification failed', err));
          console.log(`Sent project release email to ${userEmail}`);
        } else {
          console.log(`Could not find email for user ${project.user_id}, skipping release notification`);
        }
      }

      return jsonResponse(200, result);
    }

    return errorResponse(400, `Unknown action type: ${actionType}`);
  } catch (error) {
    console.error('Failed to execute project action', error);
    return errorResponse(500, 'Failed to execute action');
  }
};
