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
4. Deploy this directory with `firebase deploy --only hosting,database` — the
   rules ship with the site, or they never ship at all.
5. Smoke-test `/`, `/playerkit`, `/application`, and `/join/CODE`; verify a real
   Turnstile submission and token replay rejection before enabling
   `REQUIRE_PLAYER_APPLICATION`.

Existing Realtime Database records are deliberately untouched.

## Database rules

`database.rules.json` is deployed with `firebase deploy --only database`, so the
rules are reviewed and versioned here rather than living only in a console where
a change leaves no trace.

They deny reads outright. The root answered an unauthenticated
`GET /.json` with 200 until 2026-09-10, which put every `/kit` record — a
child's name and date of birth among them — in reach of anyone who opened the
page source. Nothing on this site reads the database: `playerkit`'s
`database.js` is the only file that touches `firebase.database()` and it only
ever writes, so closing reads costs the site nothing. The academy reads orders
through the console, which bypasses rules.

Writes stay open, because that is what the kit form does. `/kit` allows a new
entry to be created and nothing else, so an order cannot be altered or deleted
once it is in. `$other` is a wildcard holding every remaining node at the
permissiveness it already had; replace it with real rules as each node is
identified.

## The API key in `playerkit/assets/js/database.js` is not a secret

It is a Firebase Web API key. Google publishes these in client code by design —
they name the project in a request, they do not grant anything. This one is
served publicly at `/playerkit/assets/js/database.js` and always has been, so
removing it from the repository would hide nothing. What limits it is an HTTP
referrer restriction on the key in the Google Cloud console, plus the rules
above. Secret scanners flag it; it is a false positive.
