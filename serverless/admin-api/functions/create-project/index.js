const { dynamodb, cognito } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getProjectsTable } = require('../shared/env');
const { ulid } = require('ulid');
const { sendEmail } = require('../send-email');

/**
 * Get user email from Cognito by user ID (sub)
 */
async function getUserEmail(userId) {
  try {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    if (!userPoolId) return null;

    // List users with filter by sub
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
 * Create a new project on behalf of a user.
 * This allows admins to create projects when they collect images instead of the user.
 */
exports.handler = async (event) => {
  const method = (event.requestContext?.http?.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return preflightResponse();
  }

  if (method !== 'POST') {
    return errorResponse(405, 'Method not allowed');
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { userId, projectName, description, environment } = body;

    // Validate required fields
    if (!userId) {
      return errorResponse(400, 'userId is required');
    }
    if (!projectName) {
      return errorResponse(400, 'projectName is required');
    }

    const env = normalizeEnv(environment);
    const projectsTable = getProjectsTable(env);

    if (!projectsTable) {
      return errorResponse(500, 'Projects table not configured');
    }

    // Generate new project ID using ULID
    const projectId = ulid();
    const timestamp = Math.floor(Date.now() / 1000);

    // Create the project item in DynamoDB
    const projectItem = {
      PK: `PROJECT#${projectId}`,
      SK: 'METADATA',
      project_id: projectId,
      project_name: projectName,
      description: description || '',
      user_id: userId,
      tenant_id: 'default',
      status: 'creating',
      status_message: 'Project created by admin, awaiting image upload',
      file_count: 0,
      total_size_bytes: 0,
      created_at: timestamp,
      updated_at: timestamp,
      // GSI keys for querying by user
      GSI1PK: `USER#${userId}`,
      GSI1SK: `CREATED#${timestamp}`,
      // GSI keys for querying by tenant/status
      GSI2PK: 'TENANT#default',
      GSI2SK: `STATUS#CREATING#UPDATED#${timestamp}`,
    };

    console.log(`Attempting to put project ${projectId} to table ${projectsTable}...`);
    const putResult = await dynamodb.put({
      TableName: projectsTable,
      Item: projectItem,
      ConditionExpression: 'attribute_not_exists(PK)',
    }).promise();
    console.log(`DynamoDB put result:`, JSON.stringify(putResult));

    console.log(`Created project ${projectId} for user ${userId} in ${env} (table: ${projectsTable})`);

    // Send email notification to user
    const userEmail = await getUserEmail(userId);
    if (userEmail) {
      console.log(`Attempting to send email to ${userEmail}...`);
      try {
        const emailResult = await sendEmail(userEmail, 'projectCreated', {
          projectId,
          projectName,
          description: description || '',
          environment: env,
        });
        console.log(`Email result:`, JSON.stringify(emailResult));
      } catch (emailErr) {
        console.error('Email notification failed:', emailErr.message, emailErr.stack);
      }
    } else {
      console.log(`Could not find email for user ${userId}, skipping notification`);
    }

    return jsonResponse(200, {
      success: true,
      projectId,
      projectName,
      userId,
      environment: env,
      message: 'Project created successfully',
    });
  } catch (error) {
    console.error('Failed to create project', error);

    if (error.code === 'ConditionalCheckFailedException') {
      return errorResponse(409, 'Project already exists');
    }

    return errorResponse(500, 'Failed to create project');
  }
};
