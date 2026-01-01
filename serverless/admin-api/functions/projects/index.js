const { s3, cognito, dynamodb } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');
const { getProjectsTable } = require('../shared/env');

const ENVIRONMENTS = [
  {
    name: 'dev',
    bucketEnvVar: 'ORTHOS_BUCKET_DEV',
  },
  {
    name: 'prod',
    bucketEnvVar: 'ORTHOS_BUCKET_PROD',
  },
];

async function listOrgsFromBucket(bucket) {
  if (!bucket) return [];
  const response = await s3
    .listObjectsV2({
      Bucket: bucket,
      Delimiter: '/',
    })
    .promise();

  return (
    response.CommonPrefixes?.map((prefix) =>
      prefix.Prefix ? prefix.Prefix.replace('/', '') : ''
    ).filter(Boolean) || []
  );
}

async function listProjectsFromBucket(bucket, orgId) {
  if (!bucket || !orgId) return [];
  const response = await s3
    .listObjectsV2({
      Bucket: bucket,
      Prefix: `${orgId}/projects/`,
      Delimiter: '/',
    })
    .promise();

  return (
    response.CommonPrefixes?.map((prefix) => {
      if (!prefix.Prefix) return '';
      const match = prefix.Prefix.match(/projects\/(.+)\//);
      return match ? match[1] : '';
    }).filter(Boolean) || []
  );
}

async function getOrgEmailMap(userPoolId) {
  const orgMap = {};
  if (!userPoolId) {
    return orgMap;
  }

  let paginationToken;
  do {
    const response = await cognito
      .listUsers({
        UserPoolId: userPoolId,
        PaginationToken: paginationToken,
      })
      .promise();

    response.Users?.forEach((user) => {
      const username = user.Username || '';
      const emailAttr = user.Attributes?.find((attr) => attr.Name === 'email');
      const email = emailAttr?.Value || username;
      if (username) {
        orgMap[username] = { email };
      }
    });

    paginationToken = response.PaginationToken;
  } while (paginationToken);

  return orgMap;
}

/**
 * Get pending projects from DynamoDB (projects not yet processed)
 */
async function getPendingProjects(env) {
  const projectsTable = getProjectsTable(env);
  if (!projectsTable) return [];

  const pendingProjects = [];
  const pendingStatuses = ['creating', 'uploading', 'validating', 'processing'];

  try {
    // Scan for projects with pending statuses
    let lastEvaluatedKey;
    do {
      const params = {
        TableName: projectsTable,
        FilterExpression: 'SK = :metadata AND #status IN (:s1, :s2, :s3, :s4)',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':metadata': 'METADATA',
          ':s1': 'creating',
          ':s2': 'uploading',
          ':s3': 'validating',
          ':s4': 'processing',
        },
      };

      if (lastEvaluatedKey) {
        params.ExclusiveStartKey = lastEvaluatedKey;
      }

      const response = await dynamodb.scan(params).promise();

      for (const item of response.Items || []) {
        pendingProjects.push({
          orgId: item.user_id,
          projectId: item.project_id,
          projectName: item.project_name,
          description: item.description,
          status: item.status,
          statusMessage: item.status_message,
          fileCount: item.file_count || 0,
          totalSizeBytes: item.total_size_bytes || 0,
          createdAt: item.created_at,
          environment: env,
        });
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  } catch (error) {
    console.error(`Failed to get pending projects for ${env}:`, error);
  }

  return pendingProjects;
}

exports.handler = async (event) => {
  if ((event.requestContext?.http?.method || '').toUpperCase() === 'OPTIONS') {
    return preflightResponse();
  }
  try {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const orgEmailMap = await getOrgEmailMap(userPoolId);
    const allProjects = [];
    const pendingProjects = [];
    const seen = new Set();

    for (const envConfig of ENVIRONMENTS) {
      const bucket = process.env[envConfig.bucketEnvVar];
      if (!bucket) continue;

      // Get processed projects from S3 (have orthophotos)
      const organizations = await listOrgsFromBucket(bucket);
      for (const orgId of organizations) {
        if (!orgId.includes('-')) continue;

        const projects = await listProjectsFromBucket(bucket, orgId);
        for (const projectId of projects) {
          const key = `${envConfig.name}-${orgId}-${projectId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allProjects.push({
            orgId,
            projectId,
            environment: envConfig.name,
          });
        }
      }

      // Get pending projects from DynamoDB
      const envPendingProjects = await getPendingProjects(envConfig.name);
      for (const project of envPendingProjects) {
        const key = `${envConfig.name}-${project.orgId}-${project.projectId}`;
        if (!seen.has(key)) {
          pendingProjects.push(project);
        }
      }
    }

    return jsonResponse(200, {
      projects: allProjects,
      pendingProjects: pendingProjects,
      organizations: orgEmailMap,
    });
  } catch (error) {
    console.error('Failed to list projects', error);
    return errorResponse(500, 'Failed to fetch projects');
  }
};
