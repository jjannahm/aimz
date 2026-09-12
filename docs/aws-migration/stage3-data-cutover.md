# Stage 3 — data cutover (Cloudflare D1 → AWS RDS)

> ## ⛔ Stood down. Do not run this procedure.
>
> **Cloudflare is the platform.** The AWS migration is not being pursued, and
> the precondition this document was written against was never met.
>
> An earlier version of this page opened by saying "Stage 2 brought the FastAPI
> backend to feature parity with the Cloudflare Worker." That was never true.
> Stage 2 was never completed. `backend/` does not serve twelve of the twenty-six
> endpoint families the mobile app calls — fees, invoices, kit orders, match and
> player reports, attendance requests, branches, and training metrics among them.
>
> Following the steps below would move live academy data onto an API that cannot
> serve roughly half the product, and then point the app at it.
>
> Run `npm run parity` in `cloudflare-api/` for the current gap. Nothing here is
> deleted — the tooling and the CDK stack remain on disk should AWS ever be
> revisited — but Stage 2 must genuinely be finished and verified before any of
> this becomes safe.

Stage 1 stood up the AWS infrastructure. Stage 3 was intended to move the live
data across and point clients at AWS. Nothing here deletes anything on
Cloudflare — the Worker stays serving until a final switch, so a rollback would
be just "point back".

## 0. Prerequisites

- The CDK stack is deployed (`Aimz-production`) and `run-migrations.sh` has been
  run at least once, so the RDS schema is at Alembic head.
- The API image was built from a Dockerfile that ships `scripts/` (added in this
  stage) — rebuild/redeploy the API if it predates that.
- Local tools: `wrangler`, `sqlite3`, `awscli` v2, `jq`.

## 1. Freeze writes (short window)

Put the Worker into read-only for the cutover, or simply pick a quiet window.
The importer uses `ON CONFLICT DO NOTHING`, so a re-run after a late write is
safe, but the cleanest cutover is a brief freeze.

## 2. Export D1 and materialise a SQLite file

```sh
wrangler d1 export aimz-staging-db --remote --output d1.sql
sqlite3 d1.db < d1.sql
```

`d1.sql` is a schema+data dump; `d1.db` is the queryable SQLite database the
importer reads. The importer ignores D1's schema — the RDS schema is owned by
Alembic — and only reads the data.

## 3. Dry run, then import

The importer runs *inside* the `aimz-api` container over SSM (RDS is private),
staging the dump through the media S3 bucket the instance can already read:

```sh
cd infra/aws-cdk/scripts
DRY_RUN=1 ./import-d1-data.sh /path/to/d1.db production   # counts, rolls back
./import-d1-data.sh          /path/to/d1.db production   # writes
```

What it does per table (see `backend/scripts/import_d1.py`):

- Reads each target table's columns off the SQLAlchemy models and pulls the
  same-named column from SQLite — the two schemas were kept in step, so this is
  almost all of it. The one rename is `users.password_hash` → `hashed_password`.
- Coerces by target type: SQLite `0/1` → boolean, ISO text → `timestamptz`.
- Inserts in foreign-key order with `ON CONFLICT DO NOTHING` (re-runnable).
- Ephemeral rows (refresh sessions, password-reset codes, invite claims) are
  **not** carried across — a fresh sign-in reissues them.
- Media objects in R2 are a separate copy (R2 → S3); the DB only holds the keys.

## 4. Verify

Spot-check counts and a few records against the Worker, e.g. user count, a known
squad's roster, a finished match's scoreline and its goalkeeper's clean sheets.

## 5. Point clients at AWS

- Mobile app: set `EXPO_PUBLIC_API_URL` to the ALB/ApiUrl output and ship an
  update (or flip it server-side if the app reads it remotely).
- Web: `deploy-web.sh` publishes the SPA to the web S3 bucket behind CloudFront.

## 6. Retire Cloudflare

Once traffic is on AWS and verified, decommission the Worker, D1 and R2.
Keep the D1 export (`d1.sql`) as a cold backup until you are confident.
