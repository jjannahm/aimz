# Launch readiness

State of AIMZ as of 15 September 2026. Supersedes the readiness sections of
earlier documents where they disagree.

Architecture: **Cloudflare Workers + D1 + R2**, with a **React Native / Expo**
client (native iOS and Android, plus a web export on Cloudflare Pages).

Two things that used to be here and are not part of the application any more:

- **Firebase.** Never a dependency of this app. An old AIMZ website used a
  Firebase project; those files were imported and deleted the same day, and
  `git grep` at `HEAD` finds no reference. The one match is the glyph name
  `logo-firebase` inside an icon font. If that legacy Firebase project still
  exists it is an ownership and decommissioning question, not an application
  one.
- **Player photographs.** Removed entirely in `0049_drop_player_photo.sql` and
  the change that carried it. No field, no column, no key shape, no presign, no
  read path, no client rendering. `GET /api/v1/media/players/…` is a 404 before
  storage is touched. Squad crests are unaffected. Store privacy answers were
  corrected to match.

## Completed

**Security.** Refresh-token families with reuse detection and session lineage;
access tokens bound to a live session, so revocation takes effect on the next
request; PBKDF2 at 600,000 rounds; `no-store` on private responses with the live
poll keeping its validator; production seeding refused; rate-limit bindings
mandatory in production; unhandled-error logs carry a class and digest rather
than a raw message; crest objects swept from R2 on replace and delete; a
privacy cover over the app-switcher snapshot.

**Authorisation.** No known IDOR. Every route resolves the caller from the
database per request and trusts no client-supplied role, team or id. A resource
outside scope answers 404, never 403. Same-squad visibility of football and
performance statistics is intentional product behaviour; personal details,
emergency contacts, health notes and fees sit behind a stricter guard that
refuses coaches as well.

**Pipeline.** Staging deploys on every push to `main` with a staging-scoped
token. Production is a separate gated path requiring a reviewer, restricted to
`main`, reading a token only that environment can see. Both wrangler commands
carry `--env production`. The web bundle is exported twice, and CI reads the
deployed production bundle back and fails if it contains the staging API host.

**Dependencies.** `npm audit` on the API and `pnpm audit` on mobile — including
devDependencies — both report zero. Dependabot is configured weekly with Expo's
own graph excluded. CI runs both audits advisory-only, so a new advisory reports
without blocking a release.

**Tests.** 963 passing: 229 API integration and security, 660 mobile, 74 API
unit. Both workspaces typecheck clean.

## Production-ready

- Worker, D1, R2 and Pages all exist as separate production resources, with
  their own rate-limit namespaces (3001–3007, against staging's 2001–2007).
- Production D1 carries the full schema and **no rows** in any account, player,
  team, match or application table.
- Production config contains no staging identifier of any kind — verified
  against the config, the Expo config, EAS, and the built bundle.
- Monitoring and recovery: `production-runbook.md`.
- Backup and restore: `production-d1-backup-restore.md`.

## Waiting only on the permanent domain

The app currently points at `aimz-api-production.shared-links.workers.dev` and
`aimz-egypt-production.pages.dev`. Both work. Neither is a domain AIMZ owns.

`workers_dev` stays `true` until a custom domain exists — turning it off first
would leave no reachable API at all.

**The API address is compiled into the store binary.** Changing it after
submission means a new build, a new review and a new release. Decide the domain
before uploading, not after.

When the domain is ready, in this order:

1. Add the zone to Cloudflare and let its nameservers resolve.
2. Worker → **Settings → Domains & Routes → Add → Custom Domain**. Wait for the
   certificate; confirm `curl -sI https://<api-domain>/api/v1/health`.
3. Pages project → **Custom domains**, if the web app moves too.
4. In **one** commit:
   - `wrangler.jsonc` → `env.production.vars.FRONTEND_ORIGIN`,
     `PUBLIC_FORM_ORIGIN`, `TURNSTILE_HOSTNAMES`
   - `wrangler.jsonc` → `env.production.workers_dev: false`
   - `mobile/eas.json` → `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_ORIGIN`
   - `mobile/package.json` → `web:export:production`
   - `mobile/app.json` → `ios.associatedDomains`, `android.intentFilters` host
   - `.github/workflows/ci.yml` → the two production `environment.url` values
     and the bundle assertion host
5. Merge, approve the production deploy, verify.
6. Rebuild the store binaries against the new API and submit those.

## Still required before submission, and not domain-related

These need information or access that only the owner has.

1. **Apple Team ID.** `mobile/public/.well-known/apple-app-site-association`
   still says `TEAMID`. Universal links will not work until it is the real team
   identifier. The alternative is to drop `associatedDomains` from `app.json`
   for the first submission and add it later — Apple rejects a claimed link
   feature that does not work, but does not require the feature at all.
2. **Legal identity and contact.** `app/privacy.tsx` and `app/terms.tsx` both
   state in their own text that AIMZ must publish its registered legal name,
   postal address, commercial-registration details and a monitored privacy
   email before launch. App Store Connect additionally requires a reachable
   privacy-policy URL and support URL.
3. **App Review demo account.** The app is invitation-only and shows nothing
   without a sign-in, so review cannot proceed without one. It must hold
   synthetic data only — no real child's name, photograph or family contact —
   and stay active throughout review. Credentials go in Review Notes, never in
   this repository. A draft of those notes is in
   `app-store-readiness-2026-09-13.md`.
4. **Store assets.** Screenshots at the required sizes, including iPad because
   `supportsTablet` is true. Use fictional data.
5. **Age rating and Data Safety questionnaires.** The answers to mirror are in
   `app-store-readiness-2026-09-13.md`; they were corrected to drop "Photos or
   Videos" when player photographs were removed.
6. **Device testing.** A real iPhone and iPad, with VoiceOver, Larger Text,
   Reduce Motion, denied photo permission, and offline behaviour.

## Optional post-launch hardening

Deliberately not done, with reasons.

| Item | Why it can wait |
|---|---|
| Share links never expire, stored unhashed | 256-bit random tokens, not guessable, and `no-store` now covers the responses. Expiry and hashing are a schema change better made without launch pressure. |
| Finished matches editable until the season closes | Coach-only and audited. Raising audit retention for score-affecting actions is the cheap half and is worth doing early. |
| Either coach may edit the other's team sheet in a shared fixture | A policy question, not a hole. Decide what AIMZ wants. |
| No rate limits on authenticated writes | The unauthenticated doors are covered and the binding check now fails closed. Real traffic will tune these better than a guess. |
| Media reads remain unauthenticated | Only squad crests remain; a club badge is meant to be seen. |
| No `enc:v2:` key-rotation path | Nothing sealed in production yet. Should land before real medical notes accumulate — see the runbook. |
| Session existence oracle on one training endpoint | Returns an empty list rather than 404 for a session outside your squad. Leaks existence, no data. |
| Fee payment read-then-write race | Admin-only and audited; a double-recorded payment is visible in the ledger. |

None of these is a realistic risk to a launch at academy scale.
