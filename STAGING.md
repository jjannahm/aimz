# AIMZ shared staging

This is a disposable browser preview for collaboration. Use fictional names, contact details, players, matches, and media only. It is not a production service and must not contain real academy data.

## Services

- **Web:** Cloudflare Pages project `aimz-egypt-staging`
- **API:** Cloudflare Worker `aimz-api-staging`
- **Database:** Cloudflare D1 database `aimz-staging-db` in Western Europe
- **Web URL:** `https://aimz-egypt-staging.pages.dev/`
- **API URL:** `https://aimz-api-staging.shared-links.workers.dev`

The Worker does not sleep after inactivity, so the preview no longer has Render cold starts. Photo upload and password-reset features remain disabled because staging intentionally excludes object storage and outbound email.

## Cloudflare API

The `cloudflare-api/` package **is** the AIMZ API. It serves every one of the 26
`/api/v1` endpoint families the mobile app calls — authentication, teams,
competitions, players, matches, live scoring, lineups, statistics, standings,
invitation management, fees and invoices, kit orders, match and player reports,
attendance requests, and training metrics.

`backend/` is a frozen FastAPI reference implementation. Nothing deploys it and
it is not a deployment target: it serves 14 of those 26 families and is 18
migrations behind. Run `npm run parity` in `cloudflare-api/` for the current
gap. The AWS migration that would have made it production is stood down — see
`infra/aws-cdk/README.md`.

### Required GitHub Actions secrets

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` drive both deploy jobs. The
token must carry **all** of these permissions, or the deploy fails:

| Permission | Needed for |
| --- | --- |
| Account · D1 · Edit | `wrangler d1 migrations apply --remote` |
| Account · Workers Scripts · Edit | `wrangler deploy` |
| Account · Cloudflare Pages · Edit | `wrangler pages deploy` |

A token missing D1 · Edit fails the `Deploy Worker` job with `The given account
is not valid or is not authorized to access this service [code: 7403]`. Because
`Deploy Pages` needs `Deploy Worker`, that single missing permission silently
stops every web deployment while `main` keeps merging green pull requests. If
web fixes stop reaching the preview, check this first.

### Required encrypted secrets

Set these with `wrangler secret put` or `wrangler secret bulk`; never place their values in source, GitHub, logs, or the web bundle:

- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `INITIAL_INVITE_CODE`

The Worker seeds the initial admin and invitation idempotently when authentication is first used.

### Verify and deploy

```bash
cd cloudflare-api
npm ci
npm run types
npm run typecheck
npm run deploy:dry-run
npm run db:migrate:remote
npm run deploy
```

Run `npm run db:migrate:local` and `npm run dev` for local Worker/D1 development. `.dev.vars`, `.wrangler/`, and all credentials are ignored by Git.

### Mock match data

`cloudflare-api/scripts/seed-mock-matches.mjs` fills each league with seven
fictional fixtures — five results, one in progress and one to come — and logs
their goals with varied scorers and assisters, so Standings and the Top scorers
and Top assisters tabs have realistic numbers to show. It is staging-only data
in keeping with the "Fictional data only" banner, and it reuses the teams and
players already assigned to each competition rather than inventing more.

```bash
cd cloudflare-api
API_URL=https://aimz-api-staging.shared-links.workers.dev ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed:mock-matches -- --dry-run
```

Matches it has already written are recognised by their `AIMZ Mock Ground N`
venue and left alone, so a rerun never duplicates a fixture. Drop `--dry-run` to
write.

## Cloudflare Pages web app

Build the Expo web app against the Worker and deploy the static export:

```bash
cd mobile
pnpm web:export:staging
pnpm web:deploy:cloudflare
```

`web:export:staging` sets every required `EXPO_PUBLIC_*` value, so a hand-typed
variable can never be missed. Always use it instead of running `pnpm web:export`
with your own environment; `mobile/.env` points at localhost for device
development and silently produces an unusable preview if it wins.

`EXPO_PUBLIC_*` values are inlined into the bundle when Metro transforms it, so a
warm cache can emit a bundle that still targets `http://127.0.0.1:8000`. That
shipped once and left the preview showing "Cannot reach the AIMZ server" for
every viewer. `web:export` therefore always exports with `--clear` and then runs
`scripts/verify-web-export.mjs`, which fails the build when the bundle does not
contain the API URL and app environment it was built for. CI re-checks the same
invariant against the live site after deploying.

The files in `mobile/public/` provide SPA routing, security headers, and `noindex` protection. The Worker permits the exact permanent Pages origin and local browser development origins.

## Verification

1. Open the API readiness URL and confirm `{"status":"ready"}`.
2. Open the Pages URL and confirm the staging/fictional-data marker is visible.
3. Register a player using the private invitation code.
4. Sign in as the staging admin and verify teams, competitions, players, matches, standings, and live scoring.
5. Confirm a player token receives `403` from every admin write route.
6. Confirm refresh tokens rotate and duplicate scoring operation IDs do not add a second goal.

Share credentials and invitation codes privately. Do not place them in the repository or pull requests.

## Collaboration workflow

1. Create a feature branch from `main`.
2. Push the branch and open a pull request into `main`.
3. Wait for the `Cloudflare API` and `Mobile` checks. `Cloudflare API` typechecks, tests, and bundles the Worker, and `Deploy Worker` depends on it, so a Worker that does not build cannot reach staging. `Backend` is advisory — it cannot fail the build, and it skips its own steps entirely unless the change touches `backend/`.
4. Review and merge.
5. The `main` workflow applies pending D1 migrations, deploys and probes the Worker, then deploys Pages. Do not publish the web app against an older API manually.

## Retiring Render and Neon

After the Cloudflare Pages app is verified against the Worker:

1. Delete the unused Render service from its service **Settings** page.
2. Delete the unused Neon staging project if it contains no data that must be retained.
3. Remove any Render deploy hook or repository integration.

Cloudflare deployment configuration contains no Render or Neon credentials. Deleting those external resources is irreversible, so verify the Cloudflare URLs first.

## Local development

Develop against the Worker, since that is what the app talks to:

```bash
cd cloudflare-api
npm ci
npm run db:migrate:local
npm run dev
```

### Frozen FastAPI reference

FastAPI/PostgreSQL still runs locally, but only as a reference — it is twelve
endpoint families behind and nothing deploys it:

```bash
cd backend
.venv/bin/ruff check app tests migrations
.venv/bin/pytest
.venv/bin/alembic upgrade head --sql
```

Neither the hosted preview nor anything else deploys the FastAPI implementation.
