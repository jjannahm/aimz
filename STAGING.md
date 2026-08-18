# AIMZ shared staging

This environment is a disposable browser preview for collaboration. Use fictional names, contact details, players, matches, and media only. It is not a production service and must not contain real academy data.

## Services

- **Web:** Render Static Site built from `mobile/`
- **API:** Render Free Web Service built from `backend/`
- **Database:** Neon Free PostgreSQL in a European region
- **Deployments:** `main`, after the GitHub `Backend` and `Mobile` checks pass

The Render API sleeps after inactivity and can take about a minute to restart. The web app shows its wake-up progress and retries readiness for up to 90 seconds. Photo upload and password-reset UI are disabled in staging because object storage and outbound email are intentionally excluded.

## Owner setup

### 1. Create Neon PostgreSQL

1. Create a Neon project in the nearest available European region.
2. Copy the **direct** connection string, not a pooled connection string.
3. Keep Neon's TLS options in the URL. The API converts a standard `postgresql://` URL and Neon's `sslmode`/`channel_binding` query into SQLAlchemy asyncpg settings automatically.
4. Save the value only as Render's `DATABASE_URL` secret. Never add it to a local tracked file, GitHub variable, issue, or chat.

### 2. Apply the Render Blueprint

Open the repository's Render deploy link from the README and connect `jjannahm/aimz`. The root [`render.yaml`](render.yaml) creates both services.

Enter these API secrets when prompted:

- `DATABASE_URL`: Neon direct TLS URL
- `JWT_SECRET`: unique random value of at least 32 characters
- `ADMIN_EMAIL`: fictional staging admin email
- `ADMIN_PASSWORD`: unique staging-only password
- `INITIAL_INVITE_CODE`: fictional player invitation code
- `BACKEND_CORS_ORIGINS`: initially `[]`; replace it with the web URL in step 4

Do not configure SMTP or S3 credentials for staging.

### 3. Connect the web build to the API

After the API is healthy, copy its exact HTTPS URL. Set the web service's `EXPO_PUBLIC_API_URL` to that URL and deploy the web service.

### 4. Allow the exact browser origin

Copy the web service's exact origin, with no path or trailing slash, and set the API service's `BACKEND_CORS_ORIGINS` to a JSON list such as:

```text
["https://aimz-web-staging.onrender.com"]
```

Redeploy the API. The service normalizes trailing slashes defensively, but the exact origin is preferred.

### 5. Verify the shared preview

1. Open `/api/v1/health/ready` on the API and confirm a successful JSON response.
2. Open the web URL and confirm the staging/fictional-data marker is visible.
3. Register a player using the private invitation code.
4. Sign in as the staging admin and verify teams, competitions, players, matches, standings, and live scoring.
5. Sign out, let the API sleep, then sign back in and confirm the wake-up state recovers.

Share credentials and invitation codes privately. Do not place them in the repository or pull requests.

## Collaboration workflow

1. Create a branch from `main` (for example, `feature/match-filter`).
2. Push the branch and open a pull request into `main`.
3. Wait for the `Backend` and `Mobile` checks.
4. Review and merge; Render redeploys after the required checks pass.

The collaborator needs GitHub repository access and the hosted app URL, but not Render dashboard access. A free Render Hobby workspace supports one member.

## Local preflight

```bash
cd backend
.venv/bin/ruff check app tests migrations
.venv/bin/pytest
.venv/bin/alembic upgrade head --sql

cd ../mobile
pnpm typecheck
pnpm test
pnpm exec expo install --check
EXPO_PUBLIC_API_URL=https://aimz-api-staging.example.com \
EXPO_PUBLIC_APP_ENV=staging \
EXPO_PUBLIC_ENABLE_MEDIA=false \
EXPO_PUBLIC_ENABLE_PASSWORD_RESET=false \
pnpm web:export
```

Before each deployment, inspect tracked files and the exported bundle for credentials. The only public values in the web bundle should be the API URL, environment name, and feature flags.
