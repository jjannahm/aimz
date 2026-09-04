#!/usr/bin/env bash
#
# Import a Cloudflare D1 dump into the deployed RDS Postgres database.
#
# Stage 3 of the migration. RDS is not publicly reachable, so — exactly like
# run-migrations.sh — the import runs *inside* the aimz-api container on one
# in-service instance, over SSM. The only new problem is getting the dump there:
# it is staged through the media S3 bucket the instance can already read, pulled
# onto the instance, copied into the container, imported, then cleaned up.
#
# Prepare the dump locally first (needs wrangler + sqlite3):
#
#     wrangler d1 export aimz-staging-db --remote --output d1.sql
#     sqlite3 d1.db < d1.sql
#
# Usage:
#     ./import-d1-data.sh <PATH_TO_d1.db> [ENV]      # default ENV: production
#     DRY_RUN=1 ./import-d1-data.sh d1.db            # count only, roll back
#
# Requires: awscli v2, jq, the CDK stack deployed, and an image built from a
# Dockerfile that ships scripts/ (added for this).
set -euo pipefail

DUMP="${1:?Usage: import-d1-data.sh <path-to-d1.db> [env]}"
ENV="${2:-production}"
STACK="Aimz-${ENV}"
REGION="${AWS_REGION:-$(aws configure get region)}"
DRY_RUN="${DRY_RUN:-0}"
KEY="migration/d1-$(date +%Y%m%d%H%M%S).db"

[[ -f "${DUMP}" ]] || { echo "Dump not found: ${DUMP}" >&2; exit 1; }

stack_output() {
  aws cloudformation describe-stacks \
    --stack-name "${STACK}" --region "${REGION}" \
    --query "Stacks[0].Outputs[?OutputKey=='${1}'].OutputValue" --output text
}

echo "==> Resolving stack outputs for ${STACK}..."
BUCKET=$(stack_output MediaBucketName)
ASG_NAME=$(stack_output AsgName)

INSTANCE_ID=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names "${ASG_NAME}" --region "${REGION}" \
  --query "AutoScalingGroups[0].Instances[?LifecycleState=='InService']|[0].InstanceId" \
  --output text)
if [[ -z "${INSTANCE_ID}" || "${INSTANCE_ID}" == "None" ]]; then
  echo "No in-service instance found in ${ASG_NAME}." >&2
  exit 1
fi
echo "==> Bucket: ${BUCKET}"
echo "==> Target instance: ${INSTANCE_ID}"

echo "==> Staging dump to s3://${BUCKET}/${KEY}..."
aws s3 cp "${DUMP}" "s3://${BUCKET}/${KEY}" --region "${REGION}"

IMPORT_FLAGS=""
[[ "${DRY_RUN}" == "1" ]] && IMPORT_FLAGS="--dry-run"

# One command, so a failure anywhere aborts and the temp files are still removed.
REMOTE=$(cat <<REMOTE_SCRIPT
set -e
aws s3 cp s3://${BUCKET}/${KEY} /tmp/d1-import.db --region ${REGION}
docker cp /tmp/d1-import.db aimz-api:/tmp/d1-import.db
docker exec aimz-api python -m scripts.import_d1 /tmp/d1-import.db ${IMPORT_FLAGS}
docker exec aimz-api rm -f /tmp/d1-import.db
rm -f /tmp/d1-import.db
aws s3 rm s3://${BUCKET}/${KEY} --region ${REGION}
REMOTE_SCRIPT
)

echo "==> Running import via SSM ($([[ "${DRY_RUN}" == "1" ]] && echo dry-run || echo write))..."
CMD_ID=$(aws ssm send-command \
  --region "${REGION}" \
  --instance-ids "${INSTANCE_ID}" \
  --document-name "AWS-RunShellScript" \
  --comment "AIMZ D1->RDS import" \
  --parameters commands="[$(jq -Rs . <<<"${REMOTE}")]" \
  --query "Command.CommandId" --output text)

echo "==> Waiting for command ${CMD_ID}..."
aws ssm wait command-executed \
  --region "${REGION}" --command-id "${CMD_ID}" --instance-id "${INSTANCE_ID}" || true

echo "==> Output:"
aws ssm get-command-invocation \
  --region "${REGION}" --command-id "${CMD_ID}" --instance-id "${INSTANCE_ID}" \
  --query "StandardOutputContent" --output text
echo "==> Errors (if any):"
aws ssm get-command-invocation \
  --region "${REGION}" --command-id "${CMD_ID}" --instance-id "${INSTANCE_ID}" \
  --query "StandardErrorContent" --output text

STATUS=$(aws ssm get-command-invocation \
  --region "${REGION}" --command-id "${CMD_ID}" --instance-id "${INSTANCE_ID}" \
  --query "Status" --output text)
echo "==> Status: ${STATUS}"
if [[ "${STATUS}" != "Success" ]]; then
  echo "Import did not succeed; the staged dump may remain at s3://${BUCKET}/${KEY}." >&2
  exit 1
fi
