# Solar Admin Dashboard

Next.js-based admin dashboard for managing the Solar O&M Platform. Provides internal tooling for both **thermographic** and **EL (electroluminescence)** inspection workflows, including annotation, AI inference management, and project pipeline tracking.

## Features

### Thermographic Workflow
- **Crop Annotation Tool** — interactive canvas for defining crop regions and rotation on orthomosaic images before inference
- **Project Pipeline** — monitor thermographic project stages (upload → ODM → inference → report)
- **Inference Triggering** — launch Detectron2 batch jobs, review detection results

### EL (Electroluminescence) Workflow
- **EL Projects List** (`/el/projects`) — view all EL projects across organizations
- **EL Pipeline View** (`/el/project`) — 5-stage pipeline: upload → AI detection → human review → report → release
- **EL Annotation Tool** (`/el/annotate/defects`) — canvas-based defect review and correction interface
- **EL Model Management** (`/el/model`) — AI model status (currently using mock detection; trained model pending)

### Shared Features
- View all projects across organizations (thermographic + EL)
- Track AWS Batch jobs in real-time
- Runtime dev/prod environment toggle via `NEXT_PUBLIC_ENV`

## Crop Annotation Feature

### Overview
The crop annotation tool enables engineers to pre-process orthomosaic images before running Detectron2 inference. This improves detection accuracy by:
- Focusing inference on relevant solar panel areas (reducing false positives)
- Aligning panels to a consistent orientation (improving Phase 2.1 ladder alignment)
- Excluding irrelevant regions (buildings, vegetation, non-panel areas)

### How It Works

1. **Open Annotation Interface**: Click "Edit Crop" on any project
2. **Draw Crop Region**: Use Fabric.js canvas to draw a polygon around the solar panel array
3. **Set Rotation Angle**: Draw a line along the panel orientation to specify rotation
4. **Save Annotation**: JSON is automatically uploaded to S3
5. **Run Inference**: The inference pipeline reads the annotation and applies crop/rotation transformations

### Annotation JSON Format

Crop annotations are stored in S3 at:
```
s3://solar-groundtruth-{env}/{org_id}/projects/{project_id}/groundtruth/crop_annotation.json
```

**Format:**
```json
{
  "polygon": {
    "points": [
      {"x": 100, "y": 200},
      {"x": 300, "y": 200},
      {"x": 300, "y": 400},
      {"x": 100, "y": 400}
    ]
  },
  "line": {
    "points": [
      {"x": 150, "y": 250},
      {"x": 250, "y": 300}
    ]
  },
  "metadata": {
    "previewWidth": 1024,
    "previewHeight": 768,
    "originalImageWidth": 8192,
    "originalImageHeight": 6144,
    "timestamp": "2025-11-18T19:30:00Z",
    "annotatedBy": "engineer@example.com"
  }
}
```

**Field Descriptions:**
- `polygon.points`: Array of {x, y} coordinates defining the crop region (in preview image coordinates)
- `line.points`: Two-point array defining rotation angle (start and end points)
- `metadata.previewWidth/Height`: Dimensions of the preview image shown in the annotation tool
- `metadata.originalImageWidth/Height`: Dimensions of the full-resolution orthomosaic
- Additional metadata fields for tracking and auditing

### Inference Pipeline Integration

When an inference job runs, the [entrypoint.py](../solar-detection-model/deploy/inference/entrypoint.py) script:

1. Downloads the orthomosaic from S3
2. Checks for crop annotation at the groundtruth bucket location
3. If annotation exists:
   - Scales polygon coordinates from preview to full resolution
   - Calculates rotation angle from line coordinates using `atan2(dy, dx)`
   - Applies crop and rotation transformations using rasterio
   - Saves processed orthomosaic
4. If no annotation exists:
   - Proceeds with full orthomosaic (graceful fallback)
5. Runs Detectron2 inference on the processed image

**Key Code Section** ([entrypoint.py:175-237](../solar-detection-model/deploy/inference/entrypoint.py#L175-L237)):
```python
# Try to load crop annotation from S3
env = os.environ.get("ENVIRONMENT", "dev")
groundtruth_bucket = f"solar-groundtruth-{env}"
crop_annotation_key = f"{org_id}/projects/{project_id}/groundtruth/crop_annotation.json"

s3_client.download_file(groundtruth_bucket, crop_annotation_key, str(crop_annotation_path))

# Extract polygon and line coordinates
polygon_coords = crop_data.get("polygon", {}).get("points", [])
line_coords = crop_data.get("line", {}).get("points", [])

# Calculate rotation angle from line
if len(line_coords) == 2:
    p1, p2 = line_coords
    dx = p2["x"] - p1["x"]
    dy = p2["y"] - p1["y"]
    rotation_angle = math.degrees(math.atan2(dy, dx))

# Apply crop and rotation
apply_crop_and_rotation(
    ortho_local_path,
    cropped_rotated_path,
    crop_polygon,
    rotation_angle,
    preview_width,
    preview_height
)
```

### Editing and Overriding Annotations

Crop annotations can be edited at any time:
- Open the "Edit Crop" interface again to modify the existing annotation
- New annotation completely replaces the previous one (no versioning)
- Re-run inference to apply the updated annotation
- No pipeline stages need to be reset

This allows iterative refinement:
1. Run inference with initial crop
2. Review results
3. Adjust crop region if needed
4. Re-run inference with refined crop

## Development

### Prerequisites
- Node.js 18+
- AWS credentials configured
- Access to solar-orthos-*, solar-reports-*, solar-groundtruth-* S3 buckets

### Installation

```bash
cd solar-admin-dashboard
npm install
```

### Environment Variables

Create `.env.local`:
```bash
# AWS Configuration
AWS_REGION=us-east-2
AWS_ACCOUNT_ID=002938753233

# S3 Buckets
NEXT_PUBLIC_ORTHOS_BUCKET_DEV=solar-orthos-dev
NEXT_PUBLIC_ORTHOS_BUCKET_PROD=solar-orthos-prod
NEXT_PUBLIC_REPORTS_BUCKET_DEV=solar-reports-dev
NEXT_PUBLIC_REPORTS_BUCKET_PROD=solar-reports-prod
NEXT_PUBLIC_GROUNDTRUTH_BUCKET_DEV=solar-groundtruth-dev
NEXT_PUBLIC_GROUNDTRUTH_BUCKET_PROD=solar-groundtruth-prod

# Batch Configuration
NEXT_PUBLIC_BATCH_JOB_QUEUE_DEV=solar-job-queue-dev
NEXT_PUBLIC_BATCH_JOB_QUEUE_PROD=solar-job-queue-prod
NEXT_PUBLIC_BATCH_JOB_DEFINITION_DEV=solar-inference-dev
NEXT_PUBLIC_BATCH_JOB_DEFINITION_PROD=solar-inference-prod
```

### Running Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Building for Production

```bash
npm run build
npm run start
```

## Architecture

### Technology Stack
- **Framework**: Next.js 16.0.3 (App Router)
- **UI Components**: React 19
- **Canvas Library**: Fabric.js (for annotation tool)
- **AWS SDK**: @aws-sdk/client-batch, @aws-sdk/client-s3
- **Styling**: Tailwind CSS

### Key Routes

**Thermographic:**
- `/projects` - Project list view
- `/project` - Project details and pipeline status
- `/annotate/crop` - Crop annotation interface
- `/annotate/defects` - Defect review
- `/model` - Thermographic AI model management

**EL (Electroluminescence):**
- `/el/projects` - EL projects list
- `/el/project` - EL project pipeline view (5-stage)
- `/el/annotate/defects` - EL defect annotation tool (canvas-based)
- `/el/model` - EL AI model management

**API:**
- `/api/projects/[orgId]/[projectId]/run-inference` - Trigger thermographic inference job

### API Endpoints

#### POST `/api/projects/[orgId]/[projectId]/run-inference`
Triggers AWS Batch inference job with crop annotation support.

**Query Parameters:**
- `env` - Environment (dev/prod)

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "jobId": "abcd-1234-efgh-5678",
  "jobName": "inference-PROJECT_ID-1731959400000"
}
```

**Environment Variables Passed to Batch Job:**
- `ORG_ID` - Organization identifier
- `PROJECT_ID` - Project identifier
- `SOLAR_PROJECT_ID` - Same as PROJECT_ID (legacy compatibility)
- `SOLAR_ORTHOPHOTO_KEY` - S3 key to orthomosaic
- `ENVIRONMENT` - dev/prod (determines which groundtruth bucket to use)

## Deployment

The admin dashboard is deployed separately from the main solar-web-app. It uses a **single deployment** that handles both dev and prod data via the `NEXT_PUBLIC_ENV` runtime toggle.

### Static Export (CloudFront + S3)

The Next.js config uses `output: 'export'` to generate static files:

```bash
npm run build
# Output is in the `out/` directory
# Deploy to S3 behind CloudFront
aws s3 sync out/ s3://<frontend-bucket>/ --delete
aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/*"
```

**Production URL:** `https://admin.solar.aisol.cloud` (CloudFront: `d335vf81wvlg21.cloudfront.net`)

### PM2 (Server-Side)

The `ecosystem.config.js` configures PM2 to run Next.js on port 3001:

```bash
# Start with dev environment (default)
pm2 start ecosystem.config.js

# Start with prod environment
pm2 start ecosystem.config.js --env production
```

The `NEXT_PUBLIC_ENV` variable (`dev` or `prod`) controls which S3 buckets, DynamoDB tables, and Batch queues the dashboard interacts with. Both environments' resource names are available to the serverless API simultaneously (see `template.yaml`).

### Serverless API

The admin API (Lambda functions) is deployed via AWS SAM:

```bash
cd serverless/admin-api
sam build
sam deploy --guided   # first time
sam deploy            # subsequent
```

**API URL:** `https://f6n5f8j2o0.execute-api.us-east-2.amazonaws.com`

### CI/CD

Currently, the GitHub Actions CI workflow (`ci.yml`) runs linting and tests on push/PR. There is **no automated deployment** — deployment is done manually.

## Troubleshooting

### Crop Annotations Not Applied
- Verify S3 bucket permissions for `solar-groundtruth-{env}`
- Check inference logs for crop annotation download errors
- Ensure `ENVIRONMENT` variable is set correctly in batch job
- Validate JSON format matches specification above

### Fabric.js Canvas Issues
- Check browser console for JavaScript errors
- Verify image dimensions are loaded correctly
- Ensure preview image is accessible from S3

### Inference Job Failures
- Check AWS Batch job logs in CloudWatch
- Verify job queue and job definition names
- Ensure IAM roles have S3 read/write permissions
- Check orthomosaic exists at specified S3 key

## Related Documentation

- [Inference Pipeline Documentation](../solar-detection-model/docs/INFERENCE.md)
- Annotation storage uses our in-app tools writing directly to S3 (no SageMaker Ground Truth; legacy docs are retained only for history)
- [Detectron2 Setup](../solar-detection-model/solar_detectron2/README.md)
- [Main Web App](../solar-web-app/README.md)

## Contributing

When making changes to the crop annotation feature:
1. Update this README if JSON format or workflow changes
2. Update inference pipeline documentation if integration logic changes
3. Test with both dev and prod environments
4. Verify annotations work with various orthomosaic sizes and resolutions
5. Ensure graceful fallback when annotations are missing

## License

Internal use only - Solar inspection platform.
