import { NextResponse } from 'next/server';
import { fileExistsInS3 } from '@/lib/s3-client';
import { awsConfig } from '@/lib/aws-config';

interface RouteParams {
  params: Promise<{
    orgId: string;
    projectId: string;
  }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { orgId, projectId } = await params;
  const { searchParams } = new URL(request.url);
  const env = searchParams.get('env') || 'dev';

  const bucketConfig = env === 'prod' ? awsConfig.s3.prod : awsConfig.s3.dev;
  const orthosBucket = bucketConfig.orthosBucket;
  const groundtruthBucket = bucketConfig.groundtruthBucket;

  try {
    const gtPath = `${orgId}/projects/${projectId}`;

    // Check for various pipeline artifacts
    const [
      hasOrthophoto,
      hasCropAnnotation,
      hasPreAnnotations,
      hasDefectLabels,
      hasReport,
    ] = await Promise.all([
      // Check if orthophoto exists (in orthos bucket)
      fileExistsInS3(
        `${orgId}/projects/${projectId}/odm_orthophoto/odm_orthophoto.tif`,
        orthosBucket
      ).catch(() => false),

      // Check if crop annotation exists
      fileExistsInS3(`${gtPath}/crop-annotations.json`, groundtruthBucket).catch(() => false),

      // Check if pre-annotations (from inference) exist
      fileExistsInS3(`${gtPath}/detection-pre-annotations.json`, groundtruthBucket).catch(
        () => false
      ),

      // Check if human-corrected defect labels exist
      fileExistsInS3(`${gtPath}/defect_labels.json`, groundtruthBucket).catch(() => false),

      // Check if report exists
      fileExistsInS3(`${orgId}/projects/${projectId}/reports/report.pdf`, groundtruthBucket).catch(
        () => false
      ),
    ]);

    return NextResponse.json({
      hasOrthophoto,
      hasCropAnnotation,
      hasPreAnnotations,
      hasDefectLabels,
      hasReport,
    });
  } catch (error) {
    console.error('Failed to fetch project status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project status' },
      { status: 500 }
    );
  }
}
