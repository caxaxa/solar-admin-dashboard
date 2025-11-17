import { NextResponse } from 'next/server';
import {
  readJsonFromS3,
  writeJsonToS3,
  getPresignedReadUrl,
  getProjectPath,
} from '@/lib/s3-client';
import { awsConfig } from '@/lib/aws-config';

interface RouteParams {
  params: Promise<{
    orgId: string;
    projectId: string;
  }>;
}

interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
}

interface DefectLabelsFormat {
  boundingBox?: {
    boundingBoxes: BoundingBox[];
  };
}

// GET - Load image URL and existing annotations
export async function GET(request: Request, { params }: RouteParams) {
  const { orgId, projectId } = await params;

  try {
    // Get presigned URL for the orthophoto image
    const imageKey = `${orgId}/projects/${projectId}/odm_orthophoto/odm_orthophoto.tif`;
    const imageUrl = await getPresignedReadUrl(imageKey, awsConfig.s3.orthosBucket);

    // Try to load existing defect labels
    const gtPath = getProjectPath(orgId, projectId);
    const labelsKey = `${gtPath}/defect_labels.json`;

    let annotations: DefectLabelsFormat[] = [];

    try {
      const existingLabels = await readJsonFromS3(labelsKey);
      if (existingLabels) {
        annotations = [existingLabels as DefectLabelsFormat];
      }
    } catch {
      // No existing labels, check for pre-annotations from inference
      try {
        const preAnnotationsKey = `${gtPath}/detection-pre-annotations.json`;
        const preAnnotations = await readJsonFromS3(preAnnotationsKey);
        if (preAnnotations && typeof preAnnotations === 'object') {
          // Convert from inference format to defect labels format
          const inferenceData = preAnnotations as { annotations?: Array<{
            class_id: number;
            left: number;
            top: number;
            width: number;
            height: number;
          }> };

          if (inferenceData.annotations) {
            const CLASS_MAP: Record<number, string> = {
              0: 'default_panel',
              1: 'hotspots',
              2: 'faultydiodes',
              3: 'offlinepanels',
            };

            const boxes: BoundingBox[] = inferenceData.annotations.map((ann) => ({
              left: ann.left,
              top: ann.top,
              width: ann.width,
              height: ann.height,
              label: CLASS_MAP[ann.class_id] || 'default_panel',
            }));

            annotations = [{ boundingBox: { boundingBoxes: boxes } }];
          }
        }
      } catch {
        // No pre-annotations either, start fresh
        console.log('No existing annotations found, starting fresh');
      }
    }

    return NextResponse.json({
      imageUrl,
      annotations,
    });
  } catch (error) {
    console.error('Failed to load annotations:', error);
    return NextResponse.json(
      { error: 'Failed to load annotations' },
      { status: 500 }
    );
  }
}

// PUT - Save annotations
export async function PUT(request: Request, { params }: RouteParams) {
  const { orgId, projectId } = await params;

  try {
    const body = await request.json();
    const { boundingBoxes } = body as { boundingBoxes: BoundingBox[] };

    if (!Array.isArray(boundingBoxes)) {
      return NextResponse.json(
        { error: 'Invalid request body: boundingBoxes must be an array' },
        { status: 400 }
      );
    }

    // Format data for saving
    const defectLabels: DefectLabelsFormat = {
      boundingBox: {
        boundingBoxes,
      },
    };

    // Save to S3
    const gtPath = getProjectPath(orgId, projectId);
    const labelsKey = `${gtPath}/defect_labels.json`;

    await writeJsonToS3(labelsKey, defectLabels);

    console.log(`Saved ${boundingBoxes.length} annotations to ${labelsKey}`);

    return NextResponse.json({
      success: true,
      message: `Saved ${boundingBoxes.length} annotations`,
    });
  } catch (error) {
    console.error('Failed to save annotations:', error);
    return NextResponse.json(
      { error: 'Failed to save annotations' },
      { status: 500 }
    );
  }
}
