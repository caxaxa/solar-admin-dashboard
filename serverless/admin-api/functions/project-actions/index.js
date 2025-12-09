const { batch, s3, dynamodb } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getJobResources } = require('../shared/env');

const TRAINING_BUCKET = 'solar-ai-training';

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
  const projectsTable = `solar-projects-${env}`;
  const timestampEpoch = Math.floor(Date.now() / 1000);
  await dynamodb.update({
    TableName: projectsTable,
    Key: {
      PK: `PROJECT#${projectId}`,
      SK: 'METADATA'
    },
    UpdateExpression: 'SET released_at = :released_at, is_released = :released',
    ExpressionAttributeValues: {
      ':released_at': timestampEpoch,
      ':released': true
    }
  }).promise();
  console.log('Updated DynamoDB with released_at:', timestampEpoch);

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
      return jsonResponse(200, result);
    }

    return errorResponse(400, `Unknown action type: ${actionType}`);
  } catch (error) {
    console.error('Failed to execute project action', error);
    return errorResponse(500, 'Failed to execute action');
  }
};
