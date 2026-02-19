const { sfn, dynamodb, s3 } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
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
  setRequestEvent(event);
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

    const requestedEnv = normalizeEnv(event.queryStringParameters?.env);
    let env = requestedEnv;
    let projectsTable = getProjectsTable(env);

    // Get project metadata
    let projectResult = await dynamodb.get({
      TableName: projectsTable,
      Key: {
        PK: `PROJECT#${projectId}`,
        SK: 'METADATA',
      },
    }).promise();

    if (!projectResult.Item) {
      const fallbackEnv = env === 'prod' ? 'dev' : 'prod';
      const fallbackTable = getProjectsTable(fallbackEnv);
      if (fallbackTable) {
        const fallbackResult = await dynamodb.get({
          TableName: fallbackTable,
          Key: {
            PK: `PROJECT#${projectId}`,
            SK: 'METADATA',
          },
        }).promise();
        if (fallbackResult.Item) {
          console.log(`Project ${projectId} not found in ${env}; falling back to ${fallbackEnv}`);
          env = fallbackEnv;
          projectsTable = fallbackTable;
          projectResult = fallbackResult;
        }
      }
    }

    if (!projectResult.Item) {
      return errorResponse(404, 'Project not found');
    }

    const stepFunctionsArn = getStepFunctionsArn(env);

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
    const totalSizeBytes = completedFiles.reduce(
      (sum, f) => sum + getFileSizeBytes(f),
      0
    );
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
    const instanceVcpuMap = {
      'm5.large': 2,
      'm5.xlarge': 4,
      'm5.2xlarge': 8,
      'm5.4xlarge': 16,
      'm5.8xlarge': 32,
      'm5.12xlarge': 48,
      'm5.16xlarge': 64,
      'm5.24xlarge': 96,
    };
    const desiredVcpus = instanceVcpuMap[instanceType] || instanceVcpuMap['m5.12xlarge'];

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
        size_bytes: getFileSizeBytes(f),
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
        desired_vcpus: desiredVcpus,
        odm_profile: 'fast',
        odm_max_concurrency: '',
        odm_extra_flags: '[]',
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
  // Align with backend sizing in solar-web-app/services/api/project_api.py
  const isThermal = imageType === 'thermal';

  if (totalSizeMb < 100) {
    return isThermal ? 'm5.2xlarge' : 'm5.4xlarge';
  } else if (totalSizeMb < 500) {
    return isThermal ? 'm5.4xlarge' : 'm5.8xlarge';
  } else if (totalSizeMb < 1500) {
    return isThermal ? 'm5.8xlarge' : 'm5.12xlarge';
  } else if (totalSizeMb < 3000) {
    return isThermal ? 'm5.12xlarge' : 'm5.16xlarge';
  } else {
    return isThermal ? 'm5.16xlarge' : 'm5.24xlarge';
  }
}

function getFileSizeBytes(file) {
  const size = Number(file.file_size ?? file.size_bytes ?? file.size ?? 0);
  return Number.isFinite(size) ? size : 0;
}
