# AIMZ Egypt Scores

An iOS-first scores and academy operations app for AIMZ Egypt's girls' football teams. Players and club members can follow matches, tables, and player performance; authenticated administrators manage the same data and score matches from the sideline.

## Shared staging preview

The shared browser preview uses Cloudflare Pages for the Expo web app, Render Free for FastAPI, and Neon Free for PostgreSQL. It displays a permanent **Staging — fictional data only** marker, handles API cold starts, and disables photo upload and password reset.

Open the current preview at [aimz-egypt-staging.pages.dev](https://aimz-egypt-staging.pages.dev/). Apply the API-only Render Blueprint after creating the owner-controlled Neon and Render accounts:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/jjannahm/aimz)

Follow [STAGING.md](STAGING.md) for the exact secret, CORS, deployment, verification, and contributor steps. Never put real player or academy data in the public preview.

## What is included

- Invite-only player registration and seeded admin accounts
- JWT access tokens, rotating refresh sessions, SMTP password reset, password changes, logout, and in-app account deletion
- Managed AIMZ squads and opponents, competitions, rosters, lineups, matches, and private player/team photos
- Live-first event scoring with duplicate-tap protection, optimistic mobile feedback, corrections, and 12-second polling
- Automatically computed standings and season/per-match player statistics
- Role-gated Expo Router navigation with player and admin experiences in one app
- EAS profiles and a TestFlight/App Review checklist

The app intentionally does not include Kafka, Redis, WebSockets, push notifications, a web dashboard, or an Android release. The live read service is isolated so Redis can be introduced later if measured traffic requires it.

## Repository map

- `backend/app/`: FastAPI routes, security, SQLAlchemy models, and services
- `backend/migrations/`: PostgreSQL Alembic history
- `backend/tests/`: isolated API integration tests
- `backend/scripts/load_live.py`: configurable 1,000-client polling probe
- `mobile/app/`: Expo Router auth, player, admin, detail, and live-scoring routes
- `mobile/src/`: typed API client, generated OpenAPI types, auth state, theme, and components
- `mobile/TESTFLIGHT_CHECKLIST.md`: release and review handoff
- `mobile/assets/branding/`: placeholder branding and official-asset replacement instructions
- `render.yaml`: free Render API Blueprint
- `mobile/public/`: Cloudflare Pages routing and preview headers
- `.github/workflows/ci.yml`: backend and mobile deployment gates
- `STAGING.md`: Neon, Render, CORS, and collaboration runbook

## Local setup

### 1. Environment and PostgreSQL

```bash
cp .env.example .env
docker compose up -d postgres
```

Docker is optional if PostgreSQL 17 is already available locally. SQLite is used only by isolated automated tests, never as the app's runtime database.

### 2. API

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env
alembic upgrade head
aimz-seed
uvicorn app.main:app --reload
```

Check `http://127.0.0.1:8000/api/v1/health` and `/api/v1/health/ready`. API documentation is available at `/docs` outside production.

`aimz-seed` creates the first admin, optional review admin, and initial player invite from environment variables. Change every example credential before using a shared environment.

### 3. Mobile app

```bash
cd mobile
pnpm install
cp .env.example .env
pnpm ios
```

The simulator can reach `http://127.0.0.1:8000`. A physical iPhone must use the Mac's LAN address in `EXPO_PUBLIC_API_URL`; TestFlight must use a production HTTPS endpoint.

## Required configuration

### Authentication and review

- `JWT_SECRET`: at least 32 random characters in production
- `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`: first seeded admin
- `INITIAL_INVITE_CODE`: first academy registration code
- `REVIEW_NAME`, `REVIEW_EMAIL`, `REVIEW_PASSWORD`: optional App Review admin

Never commit real passwords or place review credentials in the public README. Add them only to the deployment secret store and App Store Connect's review notes.

### Password reset email

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, and `SMTP_START_TLS`. In development without SMTP, reset codes are logged by the API; production refuses silent email failure.

### Private image storage

Configure `S3_ENDPOINT_URL`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_BUCKET`. The API issues size-limited presigned uploads for JPEG, PNG, and WebP files and short-lived signed read URLs. The bucket must remain private and allow the mobile origin's presigned POST policy.

## Administration flow

1. Seed the initial admin and sign in.
2. Create AIMZ squads and opponent teams, then competitions and roster players.
3. Create a match and move it from Scheduled to Live.
4. Use Live Scoring to add events, mark starters, and enter minutes.
5. Correct events from the timeline if necessary, then finish the match.
6. Standings and player totals update from finished-match data automatically.
7. Generate and distribute new player invitation codes from Manage → Invites.

Admin authorization is enforced by FastAPI. Hiding the Manage tab is not the security boundary.

## API types and tests

Regenerate the app's API schema while FastAPI is running:

```bash
cd mobile
pnpm api:types
```

Run verification:

```bash
cd backend
.venv/bin/ruff check app tests migrations
.venv/bin/pytest
.venv/bin/alembic upgrade head --sql

cd ../mobile
pnpm typecheck
pnpm test
npx expo install --check
npx expo export --platform web
npx expo export --platform ios
```

The live load probe requires a deployed/running API, a valid token, and a live match:

```bash
AIMZ_API_URL=https://api.example.com \
AIMZ_ACCESS_TOKEN=... \
AIMZ_MATCH_ID=... \
AIMZ_LOAD_CLIENTS=1000 \
backend/.venv/bin/python backend/scripts/load_live.py
```

## Branding and release

The navy design tokens live in `mobile/src/theme.ts`. Replace the placeholder logo, icon, splash, and optional club font using `mobile/assets/branding/README.md`; do not alter official proportions.

Complete `mobile/TESTFLIGHT_CHECKLIST.md` before creating the production EAS build. Account deletion is available at **Settings → Delete account** and must remain visible for App Review.
