#!/usr/bin/env bash
#
# Build the Expo web export against the deployed API and publish it to the
# CloudFront-backed S3 bucket, then invalidate the CDN cache.
#
# Usage:  ./deploy-web.sh <ENV>        (default env: production)
# Requires: awscli v2, node/npm, and the CDK stack already deployed.
set -euo pipefail

ENV="${1:-production}"
STACK="Aimz-${ENV}"
REGION="${AWS_REGION:-$(aws configure get region)}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

out() { aws cloudformation describe-stacks --stack-name "${STACK}" --region "${REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }

# The API is reachable same-origin through CloudFront under /api/*, so the web
# build points at the CloudFront URL by default (no mixed content). Override with
# API_URL_OVERRIDE to build against a different API base (e.g. the raw ALB).
WEB_BUCKET=$(out WebBucketName)
DIST_ID=$(out CloudFrontDistributionId)
API_URL="${API_URL_OVERRIDE:-$(out WebUrl)}"

echo "==> API_URL=${API_URL}"
echo "==> Building Expo web export..."
pushd "${REPO_ROOT}/mobile" >/dev/null
EXPO_PUBLIC_API_URL="${API_URL}" \
EXPO_PUBLIC_APP_ENV="${ENV}" \
EXPO_PUBLIC_ENABLE_MEDIA="true" \
  npm run web:export
popd >/dev/null

echo "==> Syncing dist/ to s3://${WEB_BUCKET}..."
# Long-cache the hashed assets, no-cache the HTML entrypoint.
aws s3 sync "${REPO_ROOT}/mobile/dist" "s3://${WEB_BUCKET}" \
  --region "${REGION}" --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html" --exclude "*.html"
aws s3 sync "${REPO_ROOT}/mobile/dist" "s3://${WEB_BUCKET}" \
  --region "${REGION}" \
  --cache-control "no-cache" \
  --exclude "*" --include "*.html"

echo "==> Invalidating CloudFront ${DIST_ID}..."
aws cloudfront create-invalidation --distribution-id "${DIST_ID}" --paths "/*" \
  --query "Invalidation.Id" --output text

echo "==> Done. Web is live at the CloudFront URL (WebUrl output)."
