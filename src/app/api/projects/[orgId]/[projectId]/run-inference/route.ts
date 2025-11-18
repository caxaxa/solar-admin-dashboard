import { NextResponse } from 'next/server';
import { BatchClient, SubmitJobCommand } from '@aws-sdk/client-batch';
import { awsConfig } from '@/lib/aws-config';

const batchClient = new BatchClient({ region: awsConfig.region });

interface RouteParams {
  params: Promise<{
    orgId: string;
    projectId: string;
  }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { orgId, projectId } = await params;
    const { searchParams } = new URL(request.url);
    const env = searchParams.get('env') || 'dev';

    // Get the batch configuration based on environment
    const jobQueue = env === 'prod'
      ? 'solar-job-queue-prod'
      : 'solar-job-queue-dev';

    const jobDefinition = env === 'prod'
      ? 'solar-inference-prod'
      : 'solar-inference-dev';

    // Submit the batch job
    const command = new SubmitJobCommand({
      jobName: `inference-${projectId}-${Date.now()}`,
      jobQueue,
      jobDefinition,
      containerOverrides: {
        environment: [
          { name: 'ORG_ID', value: orgId },
          { name: 'PROJECT_ID', value: projectId },
          { name: 'ENVIRONMENT', value: env },
        ],
      },
    });

    const response = await batchClient.send(command);

    return NextResponse.json({
      success: true,
      jobId: response.jobId,
      jobName: response.jobName,
    });
  } catch (error) {
    console.error('Failed to submit inference job:', error);
    return NextResponse.json(
      { error: 'Failed to submit inference job', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
