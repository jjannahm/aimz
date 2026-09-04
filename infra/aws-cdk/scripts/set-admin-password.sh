#!/usr/bin/env bash
#
# Set the admin password (and optionally admin email/name) in the app secret.
# Hosted environments reject the placeholder, so run this once before the first
# migration/seed. Rotates the JSON value in place without touching JWT_SECRET.
#
# Usage:  ./set-admin-password.sh <ENV> <ADMIN_PASSWORD> [ADMIN_EMAIL]
set -euo pipefail

ENV="${1:?usage: set-admin-password.sh <ENV> <ADMIN_PASSWORD> [ADMIN_EMAIL]}"
PASSWORD="${2:?admin password required}"
EMAIL="${3:-}"
STACK="Aimz-${ENV}"
REGION="${AWS_REGION:-$(aws configure get region)}"

SECRET_ARN=$(aws cloudformation describe-stacks --stack-name "${STACK}" --region "${REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='AppSecretArn'].OutputValue" --output text)

CURRENT=$(aws secretsmanager get-secret-value --region "${REGION}" \
  --secret-id "${SECRET_ARN}" --query SecretString --output text)

UPDATED=$(echo "${CURRENT}" | jq \
  --arg pw "${PASSWORD}" --arg em "${EMAIL}" \
  'if ($em | length) > 0 then .ADMIN_PASSWORD=$pw | .ADMIN_EMAIL=$em else .ADMIN_PASSWORD=$pw end')

aws secretsmanager put-secret-value --region "${REGION}" \
  --secret-id "${SECRET_ARN}" --secret-string "${UPDATED}" \
  --query "VersionId" --output text

echo "==> Admin password updated. Recycle instances so they pick it up:"
echo "    ./redeploy-api.sh ${ENV}"
