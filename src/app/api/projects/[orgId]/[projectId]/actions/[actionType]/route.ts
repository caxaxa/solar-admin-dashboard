import { NextResponse } from 'next/server';
import { BatchClient, SubmitJobCommand } from '@aws-sdk/client-batch';
import { awsConfig } from '@/lib/aws-config';

const batchClient = new BatchClient({ region: awsConfig.region });

interface RouteParams {
  params: Promise<{
    orgId: string;
    projectId: string;
    actionType: string;
  }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { orgId, projectId, actionType } = await params;
    const { searchParams } = new URL(request.url);
    const env = searchParams.get('env') || 'dev';

    // Handle different action types
    if (actionType === 'generate-report') {
      // Get the batch configuration based on environment
      const jobQueue = env === 'prod'
        ? 'solar-job-queue-prod'
        : 'solar-job-queue-dev';

      const jobDefinition = env === 'prod'
        ? 'solar-report-prod'
        : 'solar-report-dev';

      // Submit the batch job for report generation
      const command = new SubmitJobCommand({
        jobName: `report-${projectId}-${Date.now()}`,
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
    } else if (actionType === 'release') {
      // TODO: Implement release logic
      return NextResponse.json({
        success: false,
        message: 'Release action not yet implemented',
      }, { status: 501 });
    } else {
      return NextResponse.json(
        { error: `Unknown action type: ${actionType}` },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Failed to execute action:', error);
    return NextResponse.json(
      { error: 'Failed to execute action', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
