import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { awsConfig } from './aws-config';

// Server-side S3 client (uses IAM role or environment credentials)
export const s3Client = new S3Client({
  region: awsConfig.region,
});

// List all organizations (top-level folders in groundtruth bucket)
export async function listOrganizations(): Promise<string[]> {
  const command = new ListObjectsV2Command({
    Bucket: awsConfig.s3.groundtruthBucket,
    Delimiter: '/',
  });

  const response = await s3Client.send(command);
  const orgs = response.CommonPrefixes?.map(prefix =>
    prefix.Prefix?.replace('/', '') || ''
  ).filter(Boolean) || [];

  return orgs;
}

// List projects for an organization
export async function listProjects(orgId: string): Promise<string[]> {
  const command = new ListObjectsV2Command({
    Bucket: awsConfig.s3.groundtruthBucket,
    Prefix: `${orgId}/projects/`,
    Delimiter: '/',
  });

  const response = await s3Client.send(command);
  const projects = response.CommonPrefixes?.map(prefix => {
    const match = prefix.Prefix?.match(/projects\/([^/]+)/);
    return match ? match[1] : '';
  }).filter(Boolean) || [];

  return projects;
}

// Get presigned URL for reading an object
export async function getPresignedReadUrl(key: string, bucket?: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket || awsConfig.s3.groundtruthBucket,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
}

// Get presigned URL for writing an object
export async function getPresignedWriteUrl(key: string, contentType: string = 'application/json'): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: awsConfig.s3.groundtruthBucket,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

// Read JSON file from S3
export async function readJsonFromS3(key: string, bucket?: string): Promise<unknown> {
  const command = new GetObjectCommand({
    Bucket: bucket || awsConfig.s3.groundtruthBucket,
    Key: key,
  });

  const response = await s3Client.send(command);
  const body = await response.Body?.transformToString();
  return body ? JSON.parse(body) : null;
}

// Write JSON file to S3
export async function writeJsonToS3(key: string, data: unknown): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: awsConfig.s3.groundtruthBucket,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  });

  await s3Client.send(command);
}

// Check if a file exists in S3
export async function fileExistsInS3(key: string, bucket?: string): Promise<boolean> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket || awsConfig.s3.groundtruthBucket,
      Key: key,
    });
    await s3Client.send(command);
    return true;
  } catch {
    return false;
  }
}

// Get project groundtruth path
export function getProjectPath(orgId: string, projectId: string): string {
  return `${orgId}/projects/${projectId}/groundtruth`;
}
