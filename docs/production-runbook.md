# Production runbook

What to watch, and what to do when something breaks. Written before real family
data exists, which is the only comfortable time to write it.

Companion documents: `deployment-credentials.md` for tokens and secrets,
`production-d1-backup-restore.md` for the export and restore procedure.

## Monitoring

Cloudflare's own observability is the whole of it; no third-party SDK is
installed, and none should be added without redoing the App Store privacy
answers.

`wrangler.jsonc` sets, for both environments:

```jsonc
"observability": {
  "enabled": true,
  "logs": { "head_sampling_rate": 1, "invocation_logs": false },
  "traces": { "enabled": true, "head_sampling_rate": 0.05 }
}
```

`head_sampling_rate: 1` keeps every log the code writes deliberately.
`invocation_logs: false` drops the automatic per-request line, which at a
hundred and fifty requests a second is the entire log bill and says nothing the
warnings below do not. Traces are sampled at 5%.

### What the Worker says, and what to do about it

Read these at **Cloudflare dashboard → Workers & Pages → `aimz-api-production`
→ Logs** (live tail), or `npx wrangler tail aimz-api-production --env production`.

| Log line | Meaning | Action |
|---|---|---|
| `production configuration incomplete` | A secret or a rate-limit binding is missing. Every API route is answering 503. | Set what `missing` names. This is the only 503 that is expected, and only on a first deploy. |
| `refresh token replayed` | A refresh token was presented after it was spent. Someone holds a copy. The whole session family was revoked. | Not automatically an attack — a client that retried a stale token looks the same. Repeated lines for one `user_id` are worth contacting that family about. |
| `rate limited` | A login, refresh, invitation or password bucket ran out. | Isolated lines are normal. A sustained run against one account is a password-guessing attempt. |
| `request failed` | An unhandled exception; the caller got a generic 503. | `kind` is the error class and `digest` groups repeats. The message itself is deliberately not logged — a D1 constraint violation quotes the value that violated it, which can be a child's name. Reproduce against staging. |
| `media delete failed` | A crest could not be removed from R2 after replacement. | Harmless; a stranded object. Sweep later. |
| `nightly purge` | The cron ran: audit rows over 30 days and spent sessions removed. | Absence for several days means the cron is not firing. |
| `nightly purge failed` | The cron threw. | The activity log and `refresh_sessions` will grow until fixed. |
| `sealed field did not open` | A health note could not be decrypted. | **Serious.** Almost always means `DATA_ENCRYPTION_KEY` changed. Stop and read the key-compromise section below before writing anything. |

### 5xx, 429 and D1 pressure

- **HTTP status mix:** dashboard → the Worker → **Metrics**. Anything other than
  a flat line of 2xx/401 deserves a look. A rise in 503 is either missing
  configuration or D1 refusing work.
- **429:** expected in small numbers. A spike on `/auth/login` is credential
  stuffing; the per-account bucket is already holding it, and the address bucket
  is deliberately loose because a school's wifi is one address to us.
- **D1 overload** appears as `D1 DB is overloaded. Requests queued for too
  long.` inside a `request failed` line. Load testing traced this to sequential
  round trips per request under concurrency; the authorisation reads were
  collapsed in response. If it returns, look at what added a new round trip to a
  hot path rather than at D1 itself.
- **D1 query volume:** `npx wrangler d1 insights aimz-production-db --env production`.

### Deployment failures

GitHub → **Actions**. The production jobs are gated, so a failure is visible as
a run waiting or red rather than as a silent non-deploy. The Worker job asserts
an unauthenticated read returns 401 and warns on 503; the Pages job reads the
deployed bundle back and fails if it contains the staging API host.

### Worth setting up when there is real traffic

Cloudflare **Notifications** can email on Workers error rate. Not configured
yet, because an error-rate alarm against zero traffic is noise. Add it once
families are using the app.

## Recovery

### Roll back a Worker deployment

```bash
npx wrangler deployments list --name aimz-api-production
npx wrangler rollback --name aimz-api-production --message "why"
```

Rollback moves **code only**. It does not undo a migration, so a deploy that
migrated the database cannot be fully undone this way — see below.

### Recover from a bad migration

The procedure is in `production-d1-backup-restore.md`; the short version is that
you must have exported *before* applying. D1 has no point-in-time restore on
this plan, so the pre-migration export is the entire safety net. Never apply a
migration batch to production without one.

A migration that only drops an unused column (`0049_drop_player_photo.sql`) is
recoverable by re-adding the column. A migration that drops data is not.

### Compromised `JWT_SECRET`

Comparatively gentle: it signs sessions, it does not encrypt anything at rest.

```bash
npx wrangler secret put JWT_SECRET --env production
```

Every existing access token becomes unverifiable immediately and every account
is signed out. Refresh tokens are stored hashed in `refresh_sessions` and are
not signed with this key, so they would still be honoured — revoke them too:

```sql
UPDATE refresh_families SET revoked_at = datetime('now'), revocation_reason = 'jwt_rotation' WHERE revoked_at IS NULL;
UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE revoked_at IS NULL;
```

Then tell families they will have to sign in again.

### Compromised `DATA_ENCRYPTION_KEY`

**Read this before touching anything.** The key seals `medical_concerns` and
`medications` with AES-256-GCM. There is one version (`enc:v1:`) and no re-key
path. Replacing the secret does not re-encrypt anything — it makes every sealed
value permanently unreadable, and the API will log `sealed field did not open`
for each one rather than failing loudly.

If the key is exposed:

1. **Do not rotate first.** Export the database (`wrangler d1 export`).
2. Decrypt the affected columns offline with the **old** key.
3. Generate a new key and re-seal those values.
4. Set the new secret and import the re-sealed rows in the same maintenance
   window.

Implementing `enc:v2:` with a re-seal pass — modelled on `sealLegacyHealthData`
in `src/field-crypto.ts`, which already does this shape of work — is the proper
fix and should happen before the academy stores real medical notes at scale.

Keep the key in a password manager. Cloudflare will not show it to you again.

### Compromised CI credentials

1. Cloudflare → **Manage Account → API Tokens** → delete the affected token.
   Deleting the GitHub secret alone leaves a working credential.
2. Create a replacement (`deployment-credentials.md`) and update
   `CLOUDFLARE_API_TOKEN_STAGING` (repository secret) or
   `CLOUDFLARE_API_TOKEN_PRODUCTION` (environment secret on `production`).
3. Review **Actions → Deployments** for runs you did not approve. The production
   environment requires a reviewer, so an unapproved production deploy would be
   visible there.
4. If the staging token was exposed, assume staging data is exposed and rotate
   staging's secrets too.

### Compromised account, or a family reporting a session they did not start

```sql
UPDATE refresh_families SET revoked_at = datetime('now'), revocation_reason = 'reported' WHERE user_id = ? AND revoked_at IS NULL;
UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE user_id = ?;
```

Access tokens are checked against a live session on every request, so this takes
effect on the next call rather than in fifteen minutes. Then have them change
their password, which does the same thing and re-seals the account behind a
secret the other party does not have.
