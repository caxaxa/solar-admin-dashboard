import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { awsConfig } from '@/lib/aws-config';

const s3Client = new S3Client({ region: awsConfig.region });

interface CropAnnotations {
  polygon: Array<{ x: number; y: number }>;
  rotationLine: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null;
  isDouble: boolean;
  isVertical: boolean;
  is2H: boolean;
}

interface RouteParams {
  params: Promise<{
    orgId: string;
    projectId: string;
  }>;
}

async function getPresignedReadUrl(key: string, bucket: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  return getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

async function readJsonFromS3(key: string, bucket: string): Promise<unknown | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const response = await s3Client.send(command);
    const body = await response.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch {
    return null;
  }
}

async function checkObjectExists(bucket: string, key: string): Promise<boolean> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    await s3Client.send(command);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonToS3(key: string, data: unknown, bucket: string): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  });
  await s3Client.send(command);
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { orgId, projectId } = await params;
    const { searchParams } = new URL(request.url);
    const env = searchParams.get('env') || 'dev';

    const bucketConfig = env === 'prod' ? awsConfig.s3.prod : awsConfig.s3.dev;
    const orthosBucket = bucketConfig.orthosBucket;
    const groundtruthBucket = bucketConfig.groundtruthBucket;

    // Try to get a preview image first (JPG that browsers can display)
    // Check for preview in groundtruth bucket
    const previewKey = `${orgId}/projects/${projectId}/groundtruth/previews/crop.jpg`;
    const hasPreview = await checkObjectExists(groundtruthBucket, previewKey);

    let imageUrl: string;
    let imageMetadata: { width: number; height: number } | null = null;

    if (hasPreview) {
      // Use the preview JPG
      imageUrl = await getPresignedReadUrl(previewKey, groundtruthBucket);

      // Try to load metadata for scaling info
      const metadataKey = `${orgId}/projects/${projectId}/groundtruth/previews/crop-metadata.json`;
      const metadata = await readJsonFromS3(metadataKey, groundtruthBucket) as {
        original_width?: number;
        original_height?: number;
      } | null;

      if (metadata) {
        imageMetadata = {
          width: metadata.original_width || 0,
          height: metadata.original_height || 0,
        };
      }
    } else {
      // Fall back to orthophoto TIF (browser may not display this)
      const imageKey = `${orgId}/projects/${projectId}/odm_orthophoto/odm_orthophoto.tif`;
      imageUrl = await getPresignedReadUrl(imageKey, orthosBucket);
    }

    // Try to load existing crop annotations
    const annotationsKey = `${orgId}/projects/${projectId}/crop-annotations.json`;
    const existingAnnotations = await readJsonFromS3(annotationsKey, groundtruthBucket) as CropAnnotations | null;

    return NextResponse.json({
      imageUrl,
      imageMetadata,
      annotations: existingAnnotations || {
        polygon: [],
        rotationLine: null,
        isDouble: false,
        isVertical: false,
        is2H: false,
      },
    });
  } catch (error) {
    console.error('Failed to fetch crop annotations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch crop annotations' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { orgId, projectId } = await params;
    const { searchParams } = new URL(request.url);
    const env = searchParams.get('env') || 'dev';

    const bucketConfig = env === 'prod' ? awsConfig.s3.prod : awsConfig.s3.dev;
    const groundtruthBucket = bucketConfig.groundtruthBucket;

    const annotations: CropAnnotations = await request.json();

    // Validate the annotations structure
    if (!annotations.polygon || !Array.isArray(annotations.polygon)) {
      return NextResponse.json(
        { error: 'Invalid annotations: polygon must be an array' },
        { status: 400 }
      );
    }

    // Save to S3
    const annotationsKey = `${orgId}/projects/${projectId}/crop-annotations.json`;
    await writeJsonToS3(annotationsKey, annotations, groundtruthBucket);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save crop annotations:', error);
    return NextResponse.json(
      { error: 'Failed to save crop annotations' },
      { status: 500 }
    );
  }
}
