#!/bin/bash
# Build and deploy the Solar Admin Dashboard
# Usage: ./scripts/deploy.sh [frontend|api|all]

set -euo pipefail

COMPONENT=${1:-all}
AWS_REGION=${AWS_REGION:-us-east-2}
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Config — override via environment variables if needed
ADMIN_S3_BUCKET=${ADMIN_S3_BUCKET:-"solar-admin-frontend-002938753233"}
ADMIN_CF_DISTRIBUTION_ID=${ADMIN_CF_DISTRIBUTION_ID:-"E3V0ATR6R51CRV"}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}$1${NC}"; }
warn()  { echo -e "${YELLOW}$1${NC}"; }
error() { echo -e "${RED}$1${NC}"; exit 1; }

# --- Prerequisites -----------------------------------------------------------

check_prerequisites() {
  command -v aws >/dev/null 2>&1 || error "❌ AWS CLI not installed"
  command -v npm >/dev/null 2>&1 || error "❌ npm not installed"
  aws sts get-caller-identity >/dev/null 2>&1 || error "❌ AWS credentials not configured"
}

check_sam() {
  command -v sam >/dev/null 2>&1 || error "❌ AWS SAM CLI not installed (needed for API deploy)"
}

# --- Frontend -----------------------------------------------------------------

deploy_frontend() {
  info "🎨 Building frontend..."
  pushd "${REPO_ROOT}" >/dev/null
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  npm run build
  popd >/dev/null

  local OUT_DIR="${REPO_ROOT}/out"
  if [[ ! -d "$OUT_DIR" ]]; then
    error "❌ Build output directory 'out/' not found. Check next.config.ts has output: 'export'."
  fi

  info "📤 Syncing to s3://${ADMIN_S3_BUCKET}/"
  # JS/CSS have content-hashed filenames → cache immutably for 1 year
  aws s3 sync "${OUT_DIR}/" "s3://${ADMIN_S3_BUCKET}/" \
    --delete \
    --exclude "*.html" \
    --cache-control "public, max-age=31536000, immutable"

  # HTML must revalidate so users always get latest code
  find "${OUT_DIR}/" -name "*.html" | while read -r f; do
    key="${f#"${OUT_DIR}/"}"
    aws s3 cp "$f" "s3://${ADMIN_S3_BUCKET}/${key}" \
      --cache-control "no-cache, no-store, must-revalidate" \
      --content-type "text/html"
  done

  if [[ -n "${ADMIN_CF_DISTRIBUTION_ID}" ]]; then
    info "🌐 Invalidating CloudFront distribution ${ADMIN_CF_DISTRIBUTION_ID}..."
    aws cloudfront create-invalidation \
      --distribution-id "${ADMIN_CF_DISTRIBUTION_ID}" \
      --paths "/*" >/dev/null
  else
    warn "⚠️  ADMIN_CF_DISTRIBUTION_ID not set; skipping CloudFront invalidation."
  fi

  info "✅ Frontend deployment complete"
}

# --- API (SAM) ----------------------------------------------------------------

deploy_api() {
  check_sam

  local SAM_DIR="${REPO_ROOT}/serverless/admin-api"
  if [[ ! -f "${SAM_DIR}/template.yaml" ]]; then
    error "❌ SAM template not found at ${SAM_DIR}/template.yaml"
  fi

  info "🔧 Building SAM application..."
  pushd "${SAM_DIR}" >/dev/null
  sam build

  info "🚀 Deploying SAM application..."
  if [[ -f samconfig.toml ]]; then
    sam deploy
  else
    warn "⚠️  No samconfig.toml found. Running guided deploy (first time)..."
    sam deploy --guided
  fi
  popd >/dev/null

  info "✅ API deployment complete"
}

# --- Main ---------------------------------------------------------------------

echo "🏗️  Solar Admin Dashboard Deploy (${COMPONENT})"
echo "============================================="
check_prerequisites

case "$COMPONENT" in
  frontend)
    deploy_frontend
    ;;
  api)
    deploy_api
    ;;
  all)
    deploy_frontend
    deploy_api
    ;;
  *)
    echo "Usage: $0 [frontend|api|all]"
    exit 1
    ;;
esac

echo ""
info "🎉 Deployment complete!"
echo "   Frontend: https://admin.solar.aisol.cloud"
echo "   API:      https://f6n5f8j2o0.execute-api.us-east-2.amazonaws.com"
