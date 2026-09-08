#!/usr/bin/env bash
#
# Run Alembic migrations + the admin/invite seed against the deployed database.
#
# The API container runs uvicorn only; migrations are a deliberate one-off step
# so they never race across Auto Scaling Group instances. This picks ONE running
# instance and executes the migration inside its container over SSM (no SSH, no
# open ports). Run it once after every deploy that adds migrations.
#
# Usage:  ./run-migrations.sh <ENV>        (default env: production)
# Requires: awscli v2, jq, and the CDK stack already deployed.
set -euo pipefail

ENV="${1:-production}"
STACK="Aimz-${ENV}"
REGION="${AWS_REGION:-$(aws configure get region)}"

echo "==> Resolving Auto Scaling Group for ${STACK}..."
ASG_NAME=$(aws cloudformation describe-stacks \
  --stack-name "${STACK}" --region "${REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='AsgName'].OutputValue" --output text)

INSTANCE_ID=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names "${ASG_NAME}" --region "${REGION}" \
  --query "AutoScalingGroups[0].Instances[?LifecycleState=='InService']|[0].InstanceId" \
  --output text)

if [[ -z "${INSTANCE_ID}" || "${INSTANCE_ID}" == "None" ]]; then
  echo "No in-service instance found in ${ASG_NAME}." >&2
  exit 1
fi
echo "==> Target instance: ${INSTANCE_ID}"

echo "==> Sending migration command via SSM..."
CMD_ID=$(aws ssm send-command \
  --region "${REGION}" \
  --instance-ids "${INSTANCE_ID}" \
  --document-name "AWS-RunShellScript" \
  --comment "AIMZ alembic upgrade + seed" \
  --parameters 'commands=["docker exec aimz-api sh -c \"alembic upgrade head && aimz-seed\""]' \
  --query "Command.CommandId" --output text)

echo "==> Waiting for command ${CMD_ID} to finish..."
aws ssm wait command-executed \
  --region "${REGION}" --command-id "${CMD_ID}" --instance-id "${INSTANCE_ID}" || true

echo "==> Output:"
aws ssm get-command-invocation \
  --region "${REGION}" --command-id "${CMD_ID}" --instance-id "${INSTANCE_ID}" \
  --query "StandardOutputContent" --output text

STATUS=$(aws ssm get-command-invocation \
  --region "${REGION}" --command-id "${CMD_ID}" --instance-id "${INSTANCE_ID}" \
  --query "Status" --output text)
echo "==> Status: ${STATUS}"
[[ "${STATUS}" == "Success" ]]
