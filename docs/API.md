# Solar Admin Dashboard API Reference

Complete reference for all REST API endpoints provided by the serverless backend.

**Base URL**: `https://[api-id].execute-api.us-east-2.amazonaws.com`

**Current Deployment**: `https://f15424dikc.execute-api.us-east-2.amazonaws.com`

## Table of Contents

1. [Authentication](#authentication)
2. [Project Management](#project-management)
3. [Annotation Management](#annotation-management)
4. [Batch Operations](#batch-operations)
5. [Error Responses](#error-responses)

---

## Authentication

### POST /auth/login

Authenticate a user via AWS Cognito and validate admin group membership.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Success Response** (200):
```json
{
  "success": true,
  "accessToken": "eyJraWQiOiJ...",
  "idToken": "eyJraWQiOiJ...",
  "refreshToken": "eyJjdHkiOiJ...",
  "user": {
    "username": "user-uuid-1234",
    "email": "user@example.com",
    "groups": ["admin"],
    "isAdmin": true
  }
}
```

**Error Responses**:
- **400** Bad Request - Missing email or password
  ```json
  { "error": "Email and password are required" }
  ```

- **401** Unauthorized - Invalid credentials
  ```json
  { "error": "Authentication failed" }
  ```

- **403** Forbidden - User is not in admin group
  ```json
  { "error": "Access denied. Admin privileges required." }
  ```

- **500** Internal Server Error
  ```json
  { "error": "Internal server error" }
  ```

**Example**:
```bash
curl -X POST https://[api-id].execute-api.us-east-2.amazonaws.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "YourPassword123!"
  }'
```

**Notes**:
- Tokens should be stored in localStorage on the client
- Access token used for subsequent authenticated requests (not currently enforced at API Gateway)
- User must be in the `admin` Cognito group to authenticate successfully

---

## Project Management

### GET /projects

List all projects across all organizations and environments (dev/prod).

**Query Parameters**: None

**Success Response** (200):
```json
{
  "projects": [
    {
      "orgId": "org_01HX9T2G3K4M5N6P7Q8R9S0T1",
      "projectId": "01K98Z0HXXA61W7NT9DYY2VSCR",
      "environment": "dev"
    },
    {
      "orgId": "org_01HX9T2G3K4M5N6P7Q8R9S0T1",
      "projectId": "01K98Z0HXXA61W7NT9DYY2VSCR",
      "environment": "prod"
    }
  ],
  "organizations": {
    "org_01HX9T2G3K4M5N6P7Q8R9S0T1": {
      "email": "org@example.com"
    }
  }
}
```

**Error Responses**:
- **500** Internal Server Error
  ```json
  { "error": "Failed to fetch projects" }
  ```

**Example**:
```bash
curl https://[api-id].execute-api.us-east-2.amazonaws.com/projects
```

**Notes**:
- Scans S3 orthos buckets for all organizations and projects
- Organization email mapping retrieved from Cognito user pool
- Returns projects from both dev and prod environments
- No authentication required (consider adding in production)

---

### GET /projects/{orgId}/{projectId}/status

Get the processing status of a specific project.

**Path Parameters**:
- `orgId` (string, required) - Organization ID
- `projectId` (string, required) - Project ID

**Query Parameters**:
- `env` (string, optional) - Environment (`dev` or `prod`, default: `dev`)

**Success Response** (200):
```json
{
  "hasOrthophoto": true,
  "hasCropAnnotation": true,
  "hasDefectAnnotation": false,
  "orthophotoUrl": "https://solar-orthos-dev.s3.amazonaws.com/...",
  "cropAnnotationUrl": "https://solar-groundtruth-dev.s3.amazonaws.com/..."
}
```

**Error Responses**:
- **500** Internal Server Error
  ```json
  { "error": "Failed to fetch project status" }
  ```

**Example**:
```bash
curl "https://[api-id].execute-api.us-east-2.amazonaws.com/projects/org_01HX9T/01K98Z0H/status?env=dev"
```

**Notes**:
- Checks S3 for existence of orthophoto, annotations
- Generates presigned URLs for images when available
- URLs expire after 1 hour

---

## Annotation Management

### GET /projects/{orgId}/{projectId}/crop-annotations

Retrieve crop annotation data and preview image for a project.

**Path Parameters**:
- `orgId` (string, required) - Organization ID
- `projectId` (string, required) - Project ID

**Query Parameters**:
- `env` (string, optional) - Environment (`dev` or `prod`, default: `dev`)

**Success Response** (200):
```json
{
  "imageUrl": "https://solar-orthos-dev.s3.amazonaws.com/...?X-Amz-Signature=...",
  "imageMetadata": {
    "width": 8192,
    "height": 6144,
    "format": "tiff"
  },
  "annotations": {
    "polygon": {
      "points": [
        { "x": 100, "y": 200 },
        { "x": 300, "y": 200 },
        { "x": 300, "y": 400 },
        { "x": 100, "y": 400 }
      ]
    },
    "line": {
      "points": [
        { "x": 150, "y": 250 },
        { "x": 250, "y": 300 }
      ]
    },
    "metadata": {
      "previewWidth": 1024,
      "previewHeight": 768,
      "isDouble": false,
      "is2H": false,
      "timestamp": "2025-11-18T19:30:00Z"
    }
  }
}
```

**Error Responses**:
- **404** Not Found - Orthophoto or annotation not found
  ```json
  { "error": "Orthophoto not found" }
  ```

- **500** Internal Server Error
  ```json
  { "error": "Failed to fetch crop annotations" }
  ```

**Example**:
```bash
curl "https://[api-id].execute-api.us-east-2.amazonaws.com/projects/org_01HX9T/01K98Z0H/crop-annotations?env=dev"
```

---

### PUT /projects/{orgId}/{projectId}/crop-annotations

Save crop annotation data for a project.

**Path Parameters**:
- `orgId` (string, required) - Organization ID
- `projectId` (string, required) - Project ID

**Query Parameters**:
- `env` (string, optional) - Environment (`dev` or `prod`, default: `dev`)

**Request Body**:
```json
{
  "polygon": {
    "points": [
      { "x": 100, "y": 200 },
      { "x": 300, "y": 200 },
      { "x": 300, "y": 400 },
      { "x": 100, "y": 400 }
    ]
  },
  "rotationLine": {
    "points": [
      { "x": 150, "y": 250 },
      { "x": 250, "y": 300 }
    ]
  },
  "isDouble": false,
  "is2H": false,
  "previewWidth": 1024,
  "previewHeight": 768
}
```

**Success Response** (200):
```json
{
  "success": true,
  "message": "Crop annotation saved successfully"
}
```

**Error Responses**:
- **400** Bad Request - Invalid request body
  ```json
  { "error": "Invalid annotation data" }
  ```

- **500** Internal Server Error
  ```json
  { "error": "Failed to save crop annotations" }
  ```

**Example**:
```bash
curl -X PUT "https://[api-id].execute-api.us-east-2.amazonaws.com/projects/org_01HX9T/01K98Z0H/crop-annotations?env=dev" \
  -H "Content-Type: application/json" \
  -d '{
    "polygon": {
      "points": [{"x": 100, "y": 200}, {"x": 300, "y": 200}, {"x": 300, "y": 400}, {"x": 100, "y": 400}]
    },
    "rotationLine": {
      "points": [{"x": 150, "y": 250}, {"x": 250, "y": 300}]
    },
    "isDouble": false,
    "is2H": false,
    "previewWidth": 1024,
    "previewHeight": 768
  }'
```

**Notes**:
- Saves to `s3://solar-groundtruth-{env}/{orgId}/projects/{projectId}/groundtruth/crop_annotation.json`
- Completely replaces existing annotation (no versioning)
- Inference pipeline automatically uses this annotation when running

---

### GET /projects/{orgId}/{projectId}/annotations

Retrieve defect bounding box annotations for a project.

**Path Parameters**:
- `orgId` (string, required) - Organization ID
- `projectId` (string, required) - Project ID

**Query Parameters**:
- `env` (string, optional) - Environment (`dev` or `prod`, default: `dev`)

**Success Response** (200):
```json
{
  "imageUrl": "https://solar-orthos-dev.s3.amazonaws.com/...?X-Amz-Signature=...",
  "annotations": [
    {
      "boundingBox": {
        "boundingBoxes": [
          {
            "left": 100,
            "top": 200,
            "width": 50,
            "height": 30,
            "label": "hotspots"
          },
          {
            "left": 200,
            "top": 300,
            "width": 50,
            "height": 30,
            "label": "solarpanels"
          }
        ]
      }
    }
  ]
}
```

**Error Responses**:
- **404** Not Found - Annotations not found
  ```json
  { "error": "Annotations not found" }
  ```

- **500** Internal Server Error
  ```json
  { "error": "Failed to fetch annotations" }
  ```

**Example**:
```bash
curl "https://[api-id].execute-api.us-east-2.amazonaws.com/projects/org_01HX9T/01K98Z0H/annotations?env=dev"
```

---

### PUT /projects/{orgId}/{projectId}/annotations

Save defect bounding box annotations for a project.

**Path Parameters**:
- `orgId` (string, required) - Organization ID
- `projectId` (string, required) - Project ID

**Query Parameters**:
- `env` (string, optional) - Environment (`dev` or `prod`, default: `dev`)

**Request Body**:
```json
{
  "boundingBoxes": [
    {
      "left": 100,
      "top": 200,
      "width": 50,
      "height": 30,
      "label": "hotspots"
    },
    {
      "left": 200,
      "top": 300,
      "width": 50,
      "height": 30,
      "label": "solarpanels"
    }
  ]
}
```

**Success Response** (200):
```json
{
  "success": true,
  "message": "Annotations saved successfully"
}
```

**Error Responses**:
- **400** Bad Request - Invalid annotations
  ```json
  { "error": "Invalid annotation data" }
  ```

- **500** Internal Server Error
  ```json
  { "error": "Failed to save annotations" }
  ```

**Example**:
```bash
curl -X PUT "https://[api-id].execute-api.us-east-2.amazonaws.com/projects/org_01HX9T/01K98Z0H/annotations?env=dev" \
  -H "Content-Type: application/json" \
  -d '{
    "boundingBoxes": [
      {"left": 100, "top": 200, "width": 50, "height": 30, "label": "hotspots"}
    ]
  }'
```

---

## Batch Operations

### POST /projects/{orgId}/{projectId}/run-inference

Trigger an AWS Batch inference job for a project.

**Path Parameters**:
- `orgId` (string, required) - Organization ID
- `projectId` (string, required) - Project ID

**Query Parameters**:
- `env` (string, optional) - Environment (`dev` or `prod`, default: `dev`)

**Request Body**: None

**Success Response** (200):
```json
{
  "success": true,
  "jobId": "abcd1234-5678-90ef-ghij-klmnopqrstuv",
  "jobName": "inference-01K98Z0HXXA61W7NT9DYY2VSCR-1731959400000"
}
```

**Error Responses**:
- **500** Internal Server Error
  ```json
  { "error": "Failed to submit inference job" }
  ```

**Example**:
```bash
curl -X POST "https://[api-id].execute-api.us-east-2.amazonaws.com/projects/org_01HX9T/01K98Z0H/run-inference?env=dev"
```

**Notes**:
- Submits job to AWS Batch queue (`solar-job-queue-dev` or `solar-job-queue-prod`)
- Uses job definition (`solar-inference-dev` or `solar-inference-prod`)
- Environment variables passed to batch job:
  - `ORG_ID`
  - `PROJECT_ID`
  - `SOLAR_PROJECT_ID`
  - `SOLAR_ORTHOPHOTO_KEY`
  - `ENVIRONMENT`
- Inference automatically applies crop annotation if it exists
- Job processes orthomosaic and outputs `defect_labels.json` to reports bucket

---

### POST /projects/{orgId}/{projectId}/actions/{actionType}

Execute a project-level action (e.g., generate report, release).

**Path Parameters**:
- `orgId` (string, required) - Organization ID
- `projectId` (string, required) - Project ID
- `actionType` (string, required) - Action to execute (`generate-report`, `release`)

**Query Parameters**:
- `env` (string, optional) - Environment (`dev` or `prod`, default: `dev`)

**Request Body**: None (action-specific parameters may be added in future)

**Success Response** (200):
```json
{
  "success": true,
  "jobId": "xyz789-1234-56ab-cdef-0123456789ab",
  "jobName": "report-01K98Z0HXXA61W7NT9DYY2VSCR-1731959500000",
  "action": "generate-report"
}
```

**Error Responses**:
- **400** Bad Request - Invalid action type
  ```json
  { "error": "Invalid action type" }
  ```

- **500** Internal Server Error
  ```json
  { "error": "Failed to execute action" }
  ```

**Example**:
```bash
# Generate report
curl -X POST "https://[api-id].execute-api.us-east-2.amazonaws.com/projects/org_01HX9T/01K98Z0H/actions/generate-report?env=dev"

# Release project
curl -X POST "https://[api-id].execute-api.us-east-2.amazonaws.com/projects/org_01HX9T/01K98Z0H/actions/release?env=prod"
```

**Supported Actions**:
- `generate-report`: Submits AWS Batch job to generate inspection report PDF
- `release`: Marks project as released/published

**Notes**:
- Uses AWS Batch job queue and definition (e.g., `solar-report-dev`)
- Report generation uses defect labels and orthophoto to create PDF
- Job outputs are stored in reports bucket

---

## Error Responses

All endpoints follow a consistent error response format:

```json
{
  "error": "Human-readable error message"
}
```

### HTTP Status Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 200 | Success | Request completed successfully |
| 400 | Bad Request | Missing or invalid parameters |
| 401 | Unauthorized | Authentication failed (invalid credentials) |
| 403 | Forbidden | User lacks required permissions (not in admin group) |
| 404 | Not Found | Resource does not exist (orthophoto, annotation) |
| 500 | Internal Server Error | Server-side error (S3, Cognito, Lambda failure) |

### CORS Preflight

All endpoints support CORS preflight requests:

**Request**:
```bash
curl -X OPTIONS https://[api-id].execute-api.us-east-2.amazonaws.com/projects \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Content-Type"
```

**Response** (200):
```
Access-Control-Allow-Origin: https://admin.solar.aisol.cloud
Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS
Access-Control-Allow-Headers: *
```

**Allowed Origins**:
- `https://d335vf81wvlg21.cloudfront.net`
- `https://admin.solar.aisol.cloud`
- `http://localhost:3000` (development)

---

## Authentication & Authorization

### Current State

**⚠️ WARNING**: API endpoints (except `/auth/login`) do **NOT** currently enforce authentication at the API Gateway level.

### Recommendations for Production

1. **Add API Gateway Lambda Authorizer**:
   - Validate JWT tokens on each request
   - Check token expiration
   - Verify user is in admin group

2. **Example Authorizer**:
   ```javascript
   // Validate Authorization header
   const token = event.headers.Authorization?.replace('Bearer ', '');
   const decoded = jwt.verify(token, PUBLIC_KEY);

   // Check admin group
   if (!decoded['cognito:groups']?.includes('admin')) {
     throw new Error('Unauthorized');
   }
   ```

3. **Rate Limiting**:
   - Add API Gateway throttling
   - Per-user rate limits
   - Burst capacity configuration

### Client-Side Token Usage

Frontend should include tokens in requests:

```javascript
fetch('https://[api-id].execute-api.us-east-2.amazonaws.com/projects', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
});
```

---

## Environment Variables

Lambda functions use these environment variables (configured in SAM template):

| Variable | Description | Example |
|----------|-------------|---------|
| COGNITO_USER_POOL_ID | Cognito User Pool ID | `us-east-2_a98WW3Z3T` |
| COGNITO_CLIENT_ID | Cognito App Client ID | `6j57c6dts56j4gn0ctpokgob63` |
| GROUNDTRUTH_BUCKET_DEV | Dev annotations bucket | `solar-groundtruth-dev` |
| GROUNDTRUTH_BUCKET_PROD | Prod annotations bucket | `solar-groundtruth-prod` |
| ORTHOS_BUCKET_DEV | Dev orthophotos bucket | `solar-orthos-dev` |
| ORTHOS_BUCKET_PROD | Prod orthophotos bucket | `solar-orthos-prod` |
| PROJECTS_TABLE_DEV | Dev DynamoDB table | `solar-projects-dev` |
| PROJECTS_TABLE_PROD | Prod DynamoDB table | `solar-projects-prod` |
| JOB_QUEUE_DEV | Dev batch job queue | `solar-job-queue-dev` |
| JOB_QUEUE_PROD | Prod batch job queue | `solar-job-queue-prod` |
| INFERENCE_JOB_DEF_DEV | Dev inference job definition | `solar-inference-dev` |
| INFERENCE_JOB_DEF_PROD | Prod inference job definition | `solar-inference-prod` |
| REPORT_JOB_DEF_DEV | Dev report job definition | `solar-report-dev` |
| REPORT_JOB_DEF_PROD | Prod report job definition | `solar-report-prod` |

---

## Testing & Development

### Using curl

Test all endpoints with curl commands provided in each section above.

### Using Postman

Import the following collection (save as `solar-admin-api.postman_collection.json`):

```json
{
  "info": {
    "name": "Solar Admin API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    {
      "key": "baseUrl",
      "value": "https://f15424dikc.execute-api.us-east-2.amazonaws.com"
    }
  ],
  "item": [
    {
      "name": "Login",
      "request": {
        "method": "POST",
        "header": [],
        "body": {
          "mode": "raw",
          "raw": "{\"email\": \"admin@example.com\", \"password\": \"YourPassword\"}"
        },
        "url": "{{baseUrl}}/auth/login"
      }
    },
    {
      "name": "List Projects",
      "request": {
        "method": "GET",
        "url": "{{baseUrl}}/projects"
      }
    }
  ]
}
```

### Local Testing

Use SAM Local to test endpoints:

```bash
cd serverless/admin-api
sam local start-api --env-vars env.json
```

Then access at `http://localhost:3000/projects`.

---

## Additional Resources

- **Backend README**: [../serverless/admin-api/README.md](../serverless/admin-api/README.md) - Lambda functions and deployment
- **Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md) - System design overview
- **Deployment**: [DEPLOYMENT.md](DEPLOYMENT.md) - Full deployment guide
- **Frontend**: [../README.md](../README.md) - Admin dashboard frontend documentation

## Support

For issues or questions:
- Check CloudWatch Logs for Lambda function errors
- Review API Gateway metrics in AWS Console
- Open an issue in the repository

## License

Internal use only - Solar inspection platform.
