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

/**
 * Delete a pending project (removes from DynamoDB and S3 uploads)
 */
async function handleDelete(orgId, projectId, env) {
  const projectsTable = `solar-projects-${env}`;
  const uploadsBucket = `solar-uploads-${env}`;

  // Get project details first
  const project = await getProjectDetails(projectId, env);
  if (!project) {
    throw new Error('Project not found');
  }

  // Only allow deletion of pending projects (not yet processed)
  const allowedStatuses = ['creating', 'uploading', 'validating'];
  if (!allowedStatuses.includes(project.status)) {
    throw new Error(`Cannot delete project with status '${project.status}'. Only pending projects can be deleted.`);
  }

  // Delete S3 uploads
  const prefix = `${orgId}/projects/${projectId}/`;
  let deletedFiles = 0;
  try {
    let continuationToken;
    do {
      const listParams = {
        Bucket: uploadsBucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      };
      const listResponse = await s3.listObjectsV2(listParams).promise();

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        const deleteParams = {
          Bucket: uploadsBucket,
          Delete: {
            Objects: listResponse.Contents.map((obj) => ({ Key: obj.Key })),
          },
        };
        await s3.deleteObjects(deleteParams).promise();
        deletedFiles += listResponse.Contents.length;
      }

      continuationToken = listResponse.IsTruncated ? listResponse.NextContinuationToken : null;
    } while (continuationToken);
  } catch (err) {
    console.error('Failed to delete S3 files:', err);
    // Continue with DynamoDB deletion even if S3 fails
  }

  // Delete DynamoDB records
  const queryParams = {
    TableName: projectsTable,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `PROJECT#${projectId}` },
  };

  let deletedRecords = 0;
  let lastEvaluatedKey;
  do {
    if (lastEvaluatedKey) {
      queryParams.ExclusiveStartKey = lastEvaluatedKey;
    }
    const queryResponse = await dynamodb.query(queryParams).promise();

    for (const item of queryResponse.Items || []) {
      await dynamodb.delete({
        TableName: projectsTable,
        Key: { PK: item.PK, SK: item.SK },
      }).promise();
      deletedRecords++;
    }

    lastEvaluatedKey = queryResponse.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`Deleted project ${projectId}: ${deletedFiles} files, ${deletedRecords} DB records`);

  return {
    success: true,
    message: 'Project deleted successfully',
    deletedFiles,
    deletedRecords,
  };
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

  const projectsTable = `solar-projects-${env}`;
  const timestampEpoch = Math.floor(Date.now() / 1000);

  // Merge existing stages (older projects might not have a map here)
  const existingProject = await getProjectDetails(projectId, env);
  const existingStages = (existingProject && typeof existingProject.stages === 'object') ? existingProject.stages : {};
  const mergedStages = {
    ...existingStages,
    thermo_report: {
      status: 'COMPLETED',
      released_at: timestampEpoch,
    },
  };

  // Update DynamoDB to mark project as released
  await dynamodb.update({
    TableName: projectsTable,
    Key: {
      PK: `PROJECT#${projectId}`,
      SK: 'METADATA'
    },
    UpdateExpression: 'SET released_at = :released_at, is_released = :released, stages = :stages',
    ExpressionAttributeValues: {
      ':released_at': timestampEpoch,
      ':released': true,
      ':stages': mergedStages,
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
          jobName: `report-${projectId}-${Date.now()}`,
          jobQueue,
          jobDefinition: reportJobDefinition,
          containerOverrides: {
            environment: [
              { name: 'SOLAR_USER_ID', value: orgId },
              { name: 'SOLAR_PROJECT_ID', value: projectId },
              { name: 'ENVIRONMENT', value: env },
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

    if (actionType === 'release') {
      const result = await handleRelease(orgId, projectId, env);

      // Send email notification to user and admins on release
      const project = await getProjectDetails(projectId, env);
      const userEmail = project?.user_id ? await getUserEmail(project.user_id) : null;
      const adminEmails = await getAdminEmails();

      // Combine all recipients (user + admins), removing duplicates
      const allRecipients = [...new Set([userEmail, ...adminEmails].filter(Boolean))];

      if (allRecipients.length > 0) {
        sendEmail(allRecipients, 'projectReleased', {
          projectId,
          projectName: project?.project_name || projectId,
        }).catch(err => console.error('Release email notification failed', err));
        console.log(`Sent project release email to ${allRecipients.join(', ')}`);
      } else {
        console.log(`No recipients found for release notification`);
      }

      return jsonResponse(200, result);
    }

    if (actionType === 'delete') {
      const result = await handleDelete(orgId, projectId, env);
      return jsonResponse(200, result);
    }

    if (actionType === 'release-error') {
      // Mark project as released with error status in DynamoDB
      const projectsTable = `solar-projects-${env}`;
      const timestampEpoch = Math.floor(Date.now() / 1000);

      // Merge existing stages safely (older projects may not have a map)
      const existingProject = await getProjectDetails(projectId, env);
      const existingStages = (existingProject && typeof existingProject.stages === 'object') ? existingProject.stages : {};
      const mergedStages = {
        ...existingStages,
        thermo_report: {
          status: 'FAILED',
          released_at: timestampEpoch,
          error: true
        }
      };

      await dynamodb.update({
        TableName: projectsTable,
        Key: {
          PK: `PROJECT#${projectId}`,
          SK: 'METADATA'
        },
        UpdateExpression: 'SET released_at = :released_at, is_released = :released, release_status = :status, stages = :stages',
        ExpressionAttributeValues: {
          ':released_at': timestampEpoch,
          ':released': true,
          ':status': 'error',
          ':stages': mergedStages,
        }
      }).promise();

      // Send error notification email to user and admins
      const project = await getProjectDetails(projectId, env);
      const userEmail = project?.user_id ? await getUserEmail(project.user_id) : null;
      const adminEmails = await getAdminEmails();

      const allRecipients = [...new Set([userEmail, ...adminEmails].filter(Boolean))];

      if (allRecipients.length > 0) {
        sendEmail(allRecipients, 'projectReleasedWithError', {
          projectId,
          projectName: project?.project_name || projectId,
        }).catch(err => console.error('Release error email notification failed', err));
        console.log(`Sent project release error email to ${allRecipients.join(', ')}`);
      }

      return jsonResponse(200, {
        success: true,
        message: 'Project released with error notification sent',
        released_at: new Date(timestampEpoch * 1000).toISOString(),
      });
    }

    if (actionType === 'recompile-tex') {
      // Submit batch job to recompile TeX without regenerating the full report
      if (!jobQueue || !reportJobDefinition) {
        return errorResponse(500, 'Report job configuration missing');
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
          jobName: `recompile-tex-${projectId}-${Date.now()}`,
          jobQueue,
          jobDefinition: reportJobDefinition,
          containerOverrides: {
            environment: [
              { name: 'SOLAR_USER_ID', value: orgId },
              { name: 'SOLAR_PROJECT_ID', value: projectId },
              { name: 'ENVIRONMENT', value: env },
              { name: 'SOLAR_AREA_NAME', value: projectName },
              { name: 'SOLAR_CLIENT_NAME', value: userEmail },
              { name: 'SOLAR_COMPILE_ONLY', value: 'true' },  // Skip pipeline, only compile TeX
            ],
          },
        })
        .promise();

      return jsonResponse(200, {
        success: true,
        message: 'TeX recompilation job submitted',
        jobId: response.jobId,
        jobName: response.jobName,
      });
    }

    return errorResponse(400, `Unknown action type: ${actionType}`);
  } catch (error) {
    console.error('Failed to execute project action', error);
    return errorResponse(500, error.message || 'Failed to execute action');
  }
};
