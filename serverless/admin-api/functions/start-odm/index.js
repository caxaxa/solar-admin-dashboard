const { sfn, dynamodb, s3 } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { normalizeEnv, getProjectsTable } = require('../shared/env');

const UPLOADS_BUCKET_DEV = 'solar-uploads-dev';
const UPLOADS_BUCKET_PROD = 'solar-uploads-prod';

function getUploadsBucket(env) {
  return env === 'prod' ? UPLOADS_BUCKET_PROD : UPLOADS_BUCKET_DEV;
}

// Step Functions ARN pattern
const STEP_FUNCTIONS_ARN_DEV = 'arn:aws:states:us-east-2:002938753233:stateMachine:solar-processing-dev';
const STEP_FUNCTIONS_ARN_PROD = 'arn:aws:states:us-east-2:002938753233:stateMachine:solar-processing-prod';

function getStepFunctionsArn(env) {
  return env === 'prod' ? STEP_FUNCTIONS_ARN_PROD : STEP_FUNCTIONS_ARN_DEV;
}

/**
 * Start ODM orthophoto processing for a project via Step Functions.
 * Admin version - triggered after images are uploaded via admin dashboard.
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
    const { orgId, projectId } = event.pathParameters || {};
    if (!orgId || !projectId) {
      return errorResponse(400, 'Missing orgId or projectId');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const projectsTable = getProjectsTable(env);
    const stepFunctionsArn = getStepFunctionsArn(env);

    // Get project metadata
    const projectResult = await dynamodb.get({
      TableName: projectsTable,
      Key: {
        PK: `PROJECT#${projectId}`,
        SK: 'METADATA',
      },
    }).promise();

    if (!projectResult.Item) {
      return errorResponse(404, 'Project not found');
    }

    const project = projectResult.Item;
    const userId = project.user_id || orgId;
    const tenantId = project.tenant_id || orgId;

    // Get all completed file records for this project
    const filesResult = await dynamodb.query({
      TableName: projectsTable,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROJECT#${projectId}`,
        ':sk': 'FILE#',
      },
    }).promise();

    const files = filesResult.Items || [];
    const completedFiles = files.filter(f => f.upload_status === 'completed');

    if (completedFiles.length === 0) {
      return errorResponse(400, 'No completed uploads found. Please upload images first.');
    }

    // Calculate totals
    const totalSizeBytes = completedFiles.reduce((sum, f) => sum + (f.file_size || 0), 0);
    const totalSizeMb = totalSizeBytes / (1024 * 1024);

    // Detect image type from filenames (thermal images usually have "thermal" or "IR" in name)
    const imageType = completedFiles.some(f =>
      /thermal|ir|flir/i.test(f.filename)
    ) ? 'thermal' : 'rgb';

    // Calculate instance type based on size
    const instanceType = calculateInstanceType(totalSizeMb, imageType);
    const instanceSuffixMap = {
      'm5.large': 'm5-large',
      'm5.xlarge': 'm5-xl',
      'm5.2xlarge': 'm5-2xl',
      'm5.4xlarge': 'm5-4xl',
      'm5.8xlarge': 'm5-8xl',
      'm5.12xlarge': 'm5-12xl',
      'm5.16xlarge': 'm5-16xl',
      'm5.24xlarge': 'm5-24xl',
    };
    const jobDefSuffix = instanceSuffixMap[instanceType] || 'm5-12xl';

    // Create manifest
    const timestamp = Math.floor(Date.now() / 1000);
    const manifest = {
      project_id: projectId,
      environment: env,
      total_files: completedFiles.length,
      total_size_mb: totalSizeMb,
      image_type: imageType,
      instance_type: instanceType,
      files: completedFiles.map(f => ({
        file_id: f.file_id,
        filename: f.filename,
        s3_key: f.s3_key,
        size_bytes: f.file_size || f.size_bytes || 0,
      })),
      created_at: new Date().toISOString(),
    };

    // Upload manifest to S3
    const uploadsBucket = getUploadsBucket(env);
    const manifestKey = `${userId}/projects/${projectId}/manifest.json`;
    await s3.putObject({
      Bucket: uploadsBucket,
      Key: manifestKey,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    }).promise();

    console.log(`Uploaded manifest to s3://${uploadsBucket}/${manifestKey}`);

    // Check for existing running execution
    try {
      const existingExecutions = await sfn.listExecutions({
        stateMachineArn: stepFunctionsArn,
        statusFilter: 'RUNNING',
        maxResults: 100,
      }).promise();

      const runningExecution = existingExecutions.executions?.find(
        exec => exec.name.includes(`project-${projectId}-`)
      );

      if (runningExecution) {
        console.log(`Duplicate execution prevented for project ${projectId}`);
        return jsonResponse(200, {
          success: true,
          status: 'already_processing',
          message: `Project already processing: ${runningExecution.name}`,
          executionArn: runningExecution.executionArn,
        });
      }
    } catch (err) {
      console.error('Failed to check for duplicate executions:', err);
      // Continue anyway if check fails
    }

    // Start Step Functions execution
    const executionResponse = await sfn.startExecution({
      stateMachineArn: stepFunctionsArn,
      name: `project-${projectId}-${timestamp}`,
      input: JSON.stringify({
        project_id: projectId,
        user_id: userId,
        tenant_id: tenantId,
        manifest_key: `${userId}/projects/${projectId}/manifest.json`,
        instance_type: instanceType,
        job_definition_suffix: jobDefSuffix,
        admin_triggered: true,
      }),
    }).promise();

    // Update project status
    await dynamodb.update({
      TableName: projectsTable,
      Key: {
        PK: `PROJECT#${projectId}`,
        SK: 'METADATA',
      },
      UpdateExpression: `SET
        #status = :status,
        status_message = :message,
        step_function_execution_arn = :arn,
        processing_started_at = :started_at,
        total_size_bytes = :size,
        file_count = :count,
        image_type = :image_type,
        instance_type = :instance,
        updated_at = :timestamp,
        GSI2SK = :gsi2sk`,
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'processing',
        ':message': `ODM processing started (execution ${executionResponse.executionArn})`,
        ':arn': executionResponse.executionArn,
        ':started_at': timestamp,
        ':size': totalSizeBytes,
        ':count': completedFiles.length,
        ':image_type': imageType,
        ':instance': instanceType,
        ':timestamp': timestamp,
        ':gsi2sk': `STATUS#processing#UPDATED#${timestamp}`,
      },
    }).promise();

    console.log(`Started ODM processing for project ${projectId}: execution ${executionResponse.executionArn}`);

    return jsonResponse(200, {
      success: true,
      status: 'processing',
      executionArn: executionResponse.executionArn,
      executionName: `project-${projectId}-${timestamp}`,
      fileCount: completedFiles.length,
      totalSizeMb: Math.round(totalSizeMb * 100) / 100,
      instanceType,
    });
  } catch (error) {
    console.error('Failed to start ODM processing', error);
    return errorResponse(500, error.message || 'Failed to start ODM processing');
  }
};

/**
 * Calculate instance type based on dataset size and image type
 */
function calculateInstanceType(totalSizeMb, imageType) {
  // Thermal images need more memory due to 16-bit processing
  const isHighMemory = imageType === 'thermal';

  if (totalSizeMb < 100) {
    return isHighMemory ? 'm5.2xlarge' : 'm5.xlarge';
  } else if (totalSizeMb < 500) {
    return isHighMemory ? 'm5.4xlarge' : 'm5.2xlarge';
  } else if (totalSizeMb < 1000) {
    return isHighMemory ? 'm5.8xlarge' : 'm5.4xlarge';
  } else if (totalSizeMb < 2000) {
    return isHighMemory ? 'm5.12xlarge' : 'm5.8xlarge';
  } else if (totalSizeMb < 5000) {
    return isHighMemory ? 'm5.16xlarge' : 'm5.12xlarge';
  } else {
    return 'm5.24xlarge';
  }
}
