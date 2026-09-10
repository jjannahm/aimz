# AIMZ Firebase Hosting

This directory owns the public `aimzegypt-73b85.web.app` artifact. The root and
`/playerkit` were imported from the live site on 2026-09-10. `/application` now
posts only to the shared AIMZ API, and `/join/CODE` resolves invitations before
opening the native app or the web registration fallback.

Before deployment:

1. Replace `TURNSTILE_SITE_KEY` in `public/application/index.html` with the
   managed widget site key. Keep the secret out of this directory.
2. Replace the Apple Team ID and Android release certificate fingerprint in
   `public/.well-known/`.
3. Apply backend/D1 migrations and deploy the API first.
4. Deploy this directory with `firebase deploy --only hosting`.
5. Smoke-test `/`, `/playerkit`, `/application`, and `/join/CODE`; verify a real
   Turnstile submission and token replay rejection before enabling
   `REQUIRE_PLAYER_APPLICATION`.

Existing Realtime Database records are deliberately untouched.
