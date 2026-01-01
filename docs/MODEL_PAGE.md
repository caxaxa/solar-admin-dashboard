# AI Model Page – How to Retrain and Manage Models

This page is the control surface for retraining and promoting the CV model. It is split into three logical blocks: **Prepare**, **Run Batch job**, and **Models**.

## Key Concepts
- **Archive**: A released project’s `metadata.json` plus its TIFF and `defect_labels.json` stored in `s3://solar-ai-training/...`.
- **Manifest**: A JSON list of all archives the backend discovered. Generated under `s3://solar-ai-training/training-data/manifests/manifest-*.json`.
- **Model registry entry**: A DynamoDB item keyed by `model_version` that tracks manifest, training params, status, batch job ids, and production pointer.
- **Production pointer**: Special record `MODEL#PROD_POINTER` that tells inference which model is “prod”.

## How to Run a Retrain (current flow)
1) **Prepare** (one click)  
   - Generates a new manifest from all training archives (`training-data/manifests/manifest-*.json`).  
   - Queues a COCO build Batch job (build-only) that writes `datasets/detectron2-coco-<model>.tar.gz`.  
   - Creates a registry entry with status `queued`, the manifest URI, and the dataset target URI. Epochs/batch size are stored if you set them.

2) **Wait for COCO**  
   - The UI polls `/api/training-data/coco/status` until the dataset tar exists. Button stays disabled until ready.

3) **Run Batch job** (training)  
   - **Model version**: auto-filled from Prepare.  
   - **Prepared dataset**: auto-filled; must exist (build completes first).  
   - **Prepared manifest**: auto-filled from Prepare.  
   - **Epochs / Batch size**: passed through; `max_iter` is derived (~390 iters/epoch at batch=2).  
   - **Base model**: defaults to the production pointer (`MODEL#PROD_POINTER`) and is required. Override only if you need a different checkpoint. Base weights path is `s3://solar-ai-training/model-registry/<base>/model_final.pth`.  
   - Click **Run Batch job** to submit the GPU job (`solar-gpu-queue-v2`, job def `solar-detectron2-training-gpu:1`).

4) **Monitor and promote**  
   - Tail logs:  
     ```bash
     aws logs tail /aws/batch/job --log-stream-names <log-stream> --follow --region us-east-2
     ```  
     Get the log stream via `aws batch describe-jobs --jobs <job-id> --query 'jobs[0].container.logStreamName'`.  
   - When satisfied, click **Promote** to move the production pointer. Use **Delete** to remove non-prod entries.

## Common Questions
- **Why two buttons (Start retrain vs Launch Batch job)?**  
  Now “Prepare” creates manifest + COCO + registry entry; “Run Batch job” actually trains. This prevents accidental GPU runs and enforces dataset readiness.
- **What data goes into the manifest?**  
  All discovered `metadata.json` archives under `s3://solar-ai-training/` that are released reports (filters out `models/*` and `detectron2-solar-models/*`). Each card shows the exact files included.
- **Incremental vs scratch?**  
  Leaving “Base model” blank now *forces* use of the current production pointer. To change it, supply another `model_version` that already has weights at `model-registry/<model>/model_final.pth`.
- **Output location?**  
  Defaults to `s3://solar-ai-training/model-registry/<model_version>/` unless overridden in “Output prefix.”

## API Endpoints (used by the page)
- `GET /api/model-registry` – list models + production pointer
- `POST /api/training-data/manifests` – generate manifest
- `GET /api/training-data/archives` – list archives
- `POST /api/model-registry/retrain` – queue retrain record
- `POST /api/model-registry/{model}/launch` – submit Batch job
- `POST /api/model-registry/{model}/promote` – update prod pointer
- `DELETE /api/model-registry/{model}` – delete non-prod registry entry
