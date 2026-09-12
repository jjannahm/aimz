# AIMZ AWS CDK infrastructure

> ## ⛔ Stood down — Cloudflare is the platform
>
> AIMZ runs on Cloudflare: Pages for the web app, a Worker for the API, D1 for
> data. The AWS migration is **not** being pursued. Nothing here is deleted, so
> the option survives, but none of it is a deployment target today.
>
> Stage 2 (FastAPI feature parity) was never completed and is not being worked
> on. `backend/` serves 14 of the 26 endpoint families the mobile app calls; run
> `npm run parity` in `cloudflare-api/` for the current gap.
>
> **The compiled runbook PDF linked below predates this decision.** It still
> describes AWS as the destination and its Stage 2 estimate was stale even when
> written — it names seven route groups `backend/` already had, and put the
> migration gap at 15 when it is now 18. Read `aimz-aws-runbook.tex` instead;
> the PDF has not been recompiled.

One `cdk deploy` stands up the whole AWS platform for AIMZ Egypt: VPC, RDS
PostgreSQL, ElastiCache Redis, S3 (media + web), CloudFront, and an EC2 Auto
Scaling Group behind an ALB running the FastAPI backend. Sized for ~500
concurrent users; every instance class/count is overridable via CDK context.

**Full instructions — including the launch and update workflow — are in the
compiled runbook:** [`../../docs/aws-migration/aimz-aws-runbook.pdf`](../../docs/aws-migration/aimz-aws-runbook.pdf)
(source: `aimz-aws-runbook.tex`).

## Quick start

```bash
cd infra/aws-cdk
npm install
export AWS_REGION=eu-west-1
npx cdk bootstrap                       # once per account/region
npx cdk deploy -c env=production        # builds+pushes image, creates everything

# post-deploy (once)
./scripts/set-admin-password.sh production 'strong-password' admin@yourdomain.com
./scripts/redeploy-api.sh production
./scripts/run-migrations.sh production
./scripts/deploy-web.sh production
```

## Layout

| Path | What |
|------|------|
| `bin/aimz.ts` | CDK app entry; resolves env + context |
| `lib/aimz-stack.ts` | The entire stack (network, data, secrets, API, web) |
| `scripts/run-migrations.sh` | Alembic upgrade + seed via SSM (no SSH) |
| `scripts/deploy-web.sh` | Build Expo web export → S3 → CloudFront invalidation |
| `scripts/redeploy-api.sh` | Rolling instance refresh onto a new image/secret |
| `scripts/set-admin-password.sh` | Set `ADMIN_PASSWORD` in the app secret |

## Context knobs

`-c key=value` on `cdk deploy` (defaults tuned for ~500 concurrent users):

`env`, `apiInstanceType`, `apiMinCapacity`, `apiMaxCapacity`, `dbInstanceClass`,
`dbMultiAz`, `redisNodeType`, `webDomainName`, `webCertificateArn`,
`apiCertificateArn`. See the runbook for the table.

## Security

Credentials come from your local AWS CLI profile — never hardcoded. App secrets
live in Secrets Manager and are pulled by instances at boot. **If an AWS access
key was ever shared in plaintext, rotate it in IAM immediately.**

> Status: **stood down at Stage 1** (infrastructure + deploy tooling only).
> Stage 2 (FastAPI feature parity with the Cloudflare Worker + Redis wiring) was
> never completed. Stage 3 (data migration + cutover) is explicitly not safe to
> run and is marked as such in `docs/aws-migration/stage3-data-cutover.md`.
