#!/usr/bin/env bash
#
# Roll the API Auto Scaling Group so instances re-run their boot script:
# re-pull the latest image and re-read secrets. Use after `cdk deploy` rebuilds
# the image, or after changing the app secret.
#
# Usage:  ./redeploy-api.sh <ENV>        (default env: production)
set -euo pipefail

ENV="${1:-production}"
STACK="Aimz-${ENV}"
REGION="${AWS_REGION:-$(aws configure get region)}"

ASG_NAME=$(aws cloudformation describe-stacks --stack-name "${STACK}" --region "${REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='AsgName'].OutputValue" --output text)

echo "==> Starting instance refresh on ${ASG_NAME}..."
aws autoscaling start-instance-refresh \
  --region "${REGION}" \
  --auto-scaling-group-name "${ASG_NAME}" \
  --preferences '{"MinHealthyPercentage":50,"InstanceWarmup":180}' \
  --query "InstanceRefreshId" --output text

echo "==> Refresh started. Track it in the EC2 console > Auto Scaling Groups > Instance refresh."
