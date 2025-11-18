import { NextResponse } from 'next/server';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { awsConfig } from '@/lib/aws-config';

const s3Client = new S3Client({ region: awsConfig.region });
const cognitoClient = new CognitoIdentityProviderClient({ region: awsConfig.region });

interface Project {
  orgId: string;
  projectId: string;
  environment: 'dev' | 'prod';
}

interface OrgInfo {
  email: string;
}

async function listOrgsFromBucket(bucket: string): Promise<string[]> {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Delimiter: '/',
  });

  const response = await s3Client.send(command);
  return response.CommonPrefixes?.map(prefix =>
    prefix.Prefix?.replace('/', '') || ''
  ).filter(Boolean) || [];
}

async function listProjectsFromBucket(bucket: string, orgId: string): Promise<string[]> {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: `${orgId}/projects/`,
    Delimiter: '/',
  });

  const response = await s3Client.send(command);
  return response.CommonPrefixes?.map(prefix => {
    const match = prefix.Prefix?.match(/projects\/([^/]+)/);
    return match ? match[1] : '';
  }).filter(Boolean) || [];
}

async function getOrgEmailMap(): Promise<Record<string, OrgInfo>> {
  const orgMap: Record<string, OrgInfo> = {};

  try {
    const command = new ListUsersCommand({
      UserPoolId: awsConfig.cognito.userPoolId,
    });

    const response = await cognitoClient.send(command);

    for (const user of response.Users || []) {
      const userId = user.Username || '';
      const emailAttr = user.Attributes?.find(attr => attr.Name === 'email');
      const email = emailAttr?.Value || userId;

      orgMap[userId] = { email };
    }
  } catch (err) {
    console.error('Failed to fetch user emails:', err);
  }

  return orgMap;
}

export async function GET() {
  try {
    const allProjects: Project[] = [];
    const seenProjects = new Set<string>();

    // Fetch organization email mapping from Cognito
    const orgEmailMap = await getOrgEmailMap();

    // Fetch from both dev and prod orthos buckets (primary source of truth for projects)
    const environments = [
      { name: 'dev' as const, bucket: awsConfig.s3.dev.orthosBucket },
      { name: 'prod' as const, bucket: awsConfig.s3.prod.orthosBucket },
    ];

    for (const env of environments) {
      try {
        const organizations = await listOrgsFromBucket(env.bucket);

        for (const orgId of organizations) {
          // Skip non-UUID folders (like 'templates')
          if (!orgId.includes('-')) continue;

          const projectIds = await listProjectsFromBucket(env.bucket, orgId);
          for (const projectId of projectIds) {
            const key = `${env.name}-${orgId}-${projectId}`;
            if (!seenProjects.has(key)) {
              seenProjects.add(key);
              allProjects.push({
                orgId,
                projectId,
                environment: env.name,
              });
            }
          }
        }
      } catch (err) {
        console.error(`Failed to fetch from ${env.name}:`, err);
        // Continue with other environment
      }
    }

    return NextResponse.json({
      projects: allProjects,
      organizations: orgEmailMap,
    });
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}
