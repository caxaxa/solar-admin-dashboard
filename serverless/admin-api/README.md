# Solar Admin Dashboard - Serverless API

AWS SAM-based serverless backend for the Solar Admin Dashboard, providing REST API endpoints for project management, authentication, annotation storage, and batch job orchestration.

## Overview

This serverless backend consists of 7 Lambda functions behind an API Gateway, handling all backend operations for the admin dashboard:

- **Authentication** - Cognito-based user login and authorization
- **Project Management** - List and query solar inspection projects
- **Annotation Storage** - Save and retrieve crop/defect annotations
- **Batch Orchestration** - Trigger AWS Batch inference and report generation jobs
- **Status Tracking** - Check project processing status

## Architecture

```
API Gateway (HTTPS) → Lambda Functions → AWS Services
                                        ├→ S3 (Annotations, Orthophotos)
                                        ├→ Cognito (Authentication)
                                        ├→ DynamoDB (Project Metadata)
                                        └→ Batch (Job Queue)
```

## API Endpoints

| Method | Endpoint | Function | Purpose |
|--------|----------|----------|---------|
| GET | `/projects` | ProjectsFunction | List all projects across organizations |
| POST | `/auth/login` | AuthLoginFunction | Authenticate user via Cognito |
| GET/PUT | `/projects/{orgId}/{projectId}/crop-annotations` | CropAnnotationsFunction | Manage crop annotations |
| GET/PUT | `/projects/{orgId}/{projectId}/annotations` | DefectAnnotationsFunction | Manage defect annotations |
| GET | `/projects/{orgId}/{projectId}/status` | ProjectStatusFunction | Get project processing status |
| POST | `/projects/{orgId}/{projectId}/run-inference` | RunInferenceFunction | Trigger inference batch job |
| POST | `/projects/{orgId}/{projectId}/actions/{actionType}` | ProjectActionsFunction | Execute project actions (report generation) |

For detailed API documentation, see [../../docs/API.md](../../docs/API.md).

## Prerequisites

Before deploying, ensure you have:

1. **AWS CLI** installed and configured
   ```bash
   aws --version  # Should be >= 2.0
   aws configure  # Set up credentials
   ```

2. **AWS SAM CLI** installed
   ```bash
   sam --version  # Should be >= 1.80
   ```
   Install: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html

3. **Node.js 18+** installed
   ```bash
   node --version  # Should be >= 18.x
   ```

4. **AWS Account** with appropriate permissions:
   - Lambda function creation
   - API Gateway management
   - IAM role creation
   - S3 bucket access
   - Cognito user pool access
   - AWS Batch job submission

## Quick Start

### 1. Build the SAM Application

```bash
cd /home/ubuntu/solar-admin-dashboard/serverless/admin-api
sam build
```

This compiles the Lambda functions and prepares them for deployment.

### 2. Deploy to AWS

**First-time deployment (guided):**
```bash
sam deploy --guided
```

You'll be prompted for:
- **Stack Name**: `solar-admin-api-dev` (or `solar-admin-api-prod`)
- **AWS Region**: `us-east-2`
- **Parameters**: Accept defaults or customize (see Parameters section below)
- **Confirm changes before deploy**: Y
- **Allow SAM CLI IAM role creation**: Y
- **Save arguments to samconfig.toml**: Y

**Subsequent deployments:**
```bash
sam deploy
```

### 3. Get API Endpoint

After deployment, note the API endpoint from the outputs:
```bash
aws cloudformation describe-stacks \
  --stack-name solar-admin-api-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text
```

Example output: `https://f15424dikc.execute-api.us-east-2.amazonaws.com`

### 4. Update Frontend Configuration

Update the frontend `.env.production` file with the API endpoint:
```bash
NEXT_PUBLIC_ADMIN_API_BASE_URL=https://YOUR_API_ID.execute-api.us-east-2.amazonaws.com
```

## Configuration Parameters

The SAM template accepts the following parameters (defined in [template.yaml](template.yaml)):

### AWS Configuration
- **AwsRegion**: AWS region (default: `us-east-2`)

### Cognito Authentication
- **CognitoUserPoolId**: Cognito User Pool ID (default: `us-east-2_a98WW3Z3T`)
- **CognitoClientId**: Cognito App Client ID (default: `6j57c6dts56j4gn0ctpokgob63`)

### S3 Buckets (Development)
- **GroundtruthBucketDev**: `solar-groundtruth-dev`
- **OrthosBucketDev**: `solar-orthos-dev`

### S3 Buckets (Production)
- **GroundtruthBucketProd**: `solar-groundtruth-prod`
- **OrthosBucketProd**: `solar-orthos-prod`

### DynamoDB Tables
- **ProjectsTableDev**: `solar-projects-dev`
- **ProjectsTableProd**: `solar-projects-prod`

### AWS Batch Configuration
- **JobQueueDev**: `solar-job-queue-dev`
- **JobQueueProd**: `solar-job-queue-prod`
- **InferenceJobDefinitionDev**: `solar-inference-dev`
- **InferenceJobDefinitionProd**: `solar-inference-prod`
- **ReportJobDefinitionDev**: `solar-report-dev`
- **ReportJobDefinitionProd**: `solar-report-prod`

### Customizing Parameters

To override defaults during deployment:
```bash
sam deploy --parameter-overrides \
  CognitoUserPoolId=YOUR_POOL_ID \
  GroundtruthBucketDev=your-bucket-name
```

Or edit [samconfig.toml](samconfig.toml) (created after first deployment).

## Lambda Functions

### 1. ProjectsFunction

**Endpoint**: `GET /projects`

**Purpose**: List all projects across organizations and environments

**Permissions**:
- S3 ListBucket on groundtruth and orthos buckets (dev/prod)
- S3 GetObject on orthos buckets
- Cognito ListUsers

**Environment Variables Used**:
- GROUNDTRUTH_BUCKET_DEV/PROD
- ORTHOS_BUCKET_DEV/PROD
- COGNITO_USER_POOL_ID

### 2. AuthLoginFunction

**Endpoint**: `POST /auth/login`

**Purpose**: Authenticate user via Cognito and validate admin group membership

**Permissions**:
- Cognito InitiateAuth
- Cognito AdminListGroupsForUser
- Cognito AdminGetUser

**Environment Variables Used**:
- COGNITO_USER_POOL_ID
- COGNITO_CLIENT_ID

### 3. CropAnnotationsFunction

**Endpoint**: `GET/PUT /projects/{orgId}/{projectId}/crop-annotations`

**Purpose**: Save and retrieve crop annotation data (polygon, rotation line, metadata)

**Permissions**:
- S3 GetObject/PutObject on groundtruth and orthos buckets (dev/prod)

**Environment Variables Used**:
- GROUNDTRUTH_BUCKET_DEV/PROD
- ORTHOS_BUCKET_DEV/PROD

### 4. DefectAnnotationsFunction

**Endpoint**: `GET/PUT /projects/{orgId}/{projectId}/annotations`

**Purpose**: Save and retrieve defect bounding box annotations

**Permissions**:
- S3 GetObject/PutObject on groundtruth and orthos buckets (dev/prod)

**Environment Variables Used**:
- GROUNDTRUTH_BUCKET_DEV/PROD
- ORTHOS_BUCKET_DEV/PROD

### 5. ProjectStatusFunction

**Endpoint**: `GET /projects/{orgId}/{projectId}/status`

**Purpose**: Check project status (has orthophoto, has annotations, etc.)

**Permissions**:
- S3 GetObject/ListBucket on groundtruth and orthos buckets (dev/prod)

**Environment Variables Used**:
- GROUNDTRUTH_BUCKET_DEV/PROD
- ORTHOS_BUCKET_DEV/PROD

### 6. RunInferenceFunction

**Endpoint**: `POST /projects/{orgId}/{projectId}/run-inference`

**Purpose**: Submit AWS Batch inference job with crop annotations

**Permissions**:
- Batch SubmitJob (all resources)

**Environment Variables Used**:
- JOB_QUEUE_DEV/PROD
- INFERENCE_JOB_DEF_DEV/PROD
- ORTHOS_BUCKET_DEV/PROD

### 7. ProjectActionsFunction

**Endpoint**: `POST /projects/{orgId}/{projectId}/actions/{actionType}`

**Purpose**: Execute project-level actions (generate-report, release)

**Permissions**:
- Batch SubmitJob (all resources)

**Environment Variables Used**:
- JOB_QUEUE_DEV/PROD
- REPORT_JOB_DEF_DEV/PROD

## Shared Utilities

All Lambda functions share common utilities located in [functions/shared/](functions/shared/):

- **aws-clients.js**: Singleton AWS SDK clients (S3, Cognito, Batch, DynamoDB)
- **env.js**: Environment variable validation and access
- **http.js**: HTTP response helpers (CORS headers, error formatting)
- **s3-utils.js**: S3 operations (generate presigned URLs, check object existence)

## Local Development

### Testing Functions Locally

Use SAM Local to test functions without deploying:

```bash
# Start local API
sam local start-api

# Test specific function
sam local invoke ProjectsFunction
```

### With Environment Variables

Create `env.json`:
```json
{
  "ProjectsFunction": {
    "GROUNDTRUTH_BUCKET_DEV": "solar-groundtruth-dev",
    "ORTHOS_BUCKET_DEV": "solar-orthos-dev",
    "COGNITO_USER_POOL_ID": "us-east-2_a98WW3Z3T"
  }
}
```

Then invoke:
```bash
sam local invoke ProjectsFunction --env-vars env.json
```

## Monitoring

### CloudWatch Logs

Lambda functions automatically log to CloudWatch Logs:

```bash
# View logs for a specific function
sam logs --stack-name solar-admin-api-dev --name ProjectsFunction --tail

# Follow logs in real-time
sam logs --stack-name solar-admin-api-dev --name ProjectsFunction --tail --filter ERROR
```

### API Gateway Metrics

Monitor API Gateway in the AWS Console:
- Request count
- Latency (4xx/5xx errors)
- Integration latency
- Data transfer

## Deployment Environments

### Development (`-dev`)
- Stack: `solar-admin-api-dev`
- API: `https://[api-id].execute-api.us-east-2.amazonaws.com`
- Buckets: `*-dev`
- Job queues: `solar-job-queue-dev`

### Production (`-prod`)
- Stack: `solar-admin-api-prod`
- API: `https://[api-id].execute-api.us-east-2.amazonaws.com`
- Buckets: `*-prod`
- Job queues: `solar-job-queue-prod`

## Updating the Stack

### Deploy Code Changes

```bash
sam build
sam deploy
```

### Update Configuration

```bash
sam deploy --parameter-overrides CognitoUserPoolId=NEW_VALUE
```

### Delete Stack

```bash
sam delete --stack-name solar-admin-api-dev
```

**Warning**: This will delete all Lambda functions and API Gateway but NOT S3 buckets, Cognito, or Batch resources (they're managed separately).

## Troubleshooting

### Deployment Fails

**Issue**: `CREATE_FAILED` during stack creation

**Solutions**:
1. Check IAM permissions - ensure your AWS user/role can create Lambda functions and API Gateway
2. Verify parameter values - especially Cognito pool IDs and S3 bucket names
3. Check CloudFormation events: `aws cloudformation describe-stack-events --stack-name solar-admin-api-dev`

### Function Errors

**Issue**: Lambda functions return 500 errors

**Solutions**:
1. Check CloudWatch Logs: `sam logs --stack-name solar-admin-api-dev --name [FunctionName] --tail`
2. Verify environment variables are set correctly
3. Test S3 bucket permissions: `aws s3 ls s3://solar-groundtruth-dev`
4. Validate Cognito configuration

### CORS Errors

**Issue**: Browser shows CORS policy errors

**Solutions**:
1. Verify frontend origin is in `template.yaml` CORS configuration
2. Check API Gateway CORS settings in AWS Console
3. Ensure OPTIONS method is enabled (SAM handles this automatically)

### Authentication Failures

**Issue**: `/auth/login` returns authentication errors

**Solutions**:
1. Verify Cognito User Pool ID and Client ID match `template.yaml`
2. Check user exists in Cognito: `aws cognito-idp list-users --user-pool-id YOUR_POOL_ID`
3. Verify user is in the `admin` group for admin dashboard access
4. Check Lambda execution role has Cognito permissions

## Security Considerations

1. **API Authentication**: Currently, API endpoints (except `/auth/login`) don't enforce authentication at the API Gateway level. Consider adding:
   - API Gateway Lambda authorizer
   - JWT token validation
   - Rate limiting

2. **IAM Roles**: Lambda execution roles follow least-privilege principles - only permissions needed for each function

3. **CORS**: Production deployment should restrict CORS origins to specific domains (not `*`)

4. **Environment Separation**: Dev and prod environments use separate buckets, queues, and configuration

## Additional Resources

- **API Documentation**: [../../docs/API.md](../../docs/API.md) - Complete endpoint reference
- **Architecture**: [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) - System design
- **Deployment Guide**: [../../docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md) - Full deployment walkthrough
- **Main README**: [../../README.md](../../README.md) - Frontend documentation

## Support

For issues or questions:
- Check [../../docs/TROUBLESHOOTING.md](../../docs/TROUBLESHOOTING.md)
- Review CloudWatch Logs
- Open an issue in the repository

## License

Internal use only - Solar inspection platform.
