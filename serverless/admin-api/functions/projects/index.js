const { s3, cognito } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse } = require('../shared/http');

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

exports.handler = async (event) => {
  if ((event.requestContext?.http?.method || '').toUpperCase() === 'OPTIONS') {
    return preflightResponse();
  }
  try {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const orgEmailMap = await getOrgEmailMap(userPoolId);
    const allProjects = [];
    const seen = new Set();

    for (const envConfig of ENVIRONMENTS) {
      const bucket = process.env[envConfig.bucketEnvVar];
      if (!bucket) continue;

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
    }

    return jsonResponse(200, {
      projects: allProjects,
      organizations: orgEmailMap,
    });
  } catch (error) {
    console.error('Failed to list projects', error);
    return errorResponse(500, 'Failed to fetch projects');
  }
};
