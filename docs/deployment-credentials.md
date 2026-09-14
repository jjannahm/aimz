# Deployment credentials

Two Cloudflare tokens, never one.

CI deploys staging on every push to `main` with nobody watching. Whatever
credential that job holds is the blast radius of a bad merge, a compromised
build dependency, or anyone who can push. A single account-wide token — the
default shape when you click "Create Token" and pick a template — lets that job
deploy the production Worker and read the production D1 database. Nothing in the
workflow intends to; nothing in the workflow prevents it either.

So: a staging token that cannot see production, and a production token that a
person has to approve the use of.

These steps are manual. Nobody should be inventing token values, this file
included, and no token value belongs in this repository.

## 1. The staging token

Cloudflare dashboard → **My Profile → API Tokens → Create Token → Create Custom
Token**.

- **Name:** `aimz-ci-staging`
- **Permissions:**
  - Account → Workers Scripts → **Edit**
  - Account → D1 → **Edit**
  - Account → Cloudflare Pages → **Edit**
  - Account → Workers R2 Storage → **Edit**
- **Account Resources:** Include → your AIMZ account only
- **TTL:** set an expiry — a year is reasonable — so an abandoned token dies

Cloudflare's token permissions are account-wide for these products; they cannot
be narrowed to one Worker or one database in the token itself. That is a real
limitation and it is worth knowing rather than assuming otherwise. What you get
from a separate staging token is not isolation from production — it is a
credential you can revoke the moment CI is suspected, without taking production
deploys down with it, and an audit trail that says which token did what.

If you want true isolation, the only way Cloudflare offers it today is a
**separate account for production**, with its own D1, R2 and Pages project. That
is worth considering before launch and is a bigger change than this file.

Then, in GitHub → **Settings → Secrets and variables → Actions**:

- Add a repository secret `CLOUDFLARE_API_TOKEN_STAGING` with that value.
- Keep `CLOUDFLARE_ACCOUNT_ID` as it is.
- **Delete the old `CLOUDFLARE_API_TOKEN` secret**, and revoke that token in
  Cloudflare. A secret nothing references is still a secret that works.

`ci.yml` already reads `CLOUDFLARE_API_TOKEN_STAGING`. Until the secret exists,
the staging deploy fails — loudly, which is the intended direction.

## 2. The production token

Create a second custom token the same way:

- **Name:** `aimz-deploy-production`
- Same permissions as above
- **TTL:** set one

Store it where only a gated job can read it. GitHub → **Settings →
Environments → New environment**:

- **Name:** `production`
- Tick **Required reviewers** and add yourself (and one other person, so a
  deploy is not blocked when you are away)
- Optionally tick **Wait timer**
- Under **Deployment branches**, restrict to `main`
- Add an **environment secret** `CLOUDFLARE_API_TOKEN_PRODUCTION`

An environment secret is readable only by a job that declares
`environment: production`, and such a job pauses until a reviewer approves it.
That approval is the control — the one thing standing between a merge and the
production database.

There is no production deploy job in `ci.yml` yet, deliberately: the production
origins are still undecided (see below) and a deploy job pointing at a
half-configured Worker is worse than none. When you add one, it needs:

```yaml
  worker-production:
    name: Deploy Worker (production)
    needs: worker
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    environment:
      name: production          # this line is what forces the approval
      url: https://<production API domain>
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN_PRODUCTION }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: cloudflare-api
          wranglerVersion: "4.124.0"
          preCommands: wrangler d1 migrations apply aimz-production-db --remote --env production
          command: deploy --minify --env production
```

Note `--env production` on both commands. Without it, wrangler reads the
top-level config and deploys the production token straight at the staging
database — the exact accident the split config in `wrangler.jsonc` exists to
prevent.

## 3. The production secrets

Set once, by hand, never in CI:

```bash
wrangler secret put JWT_SECRET --env production           # 32+ random chars
wrangler secret put DATA_ENCRYPTION_KEY --env production  # 32+ random bytes, never rotated casually
wrangler secret put TURNSTILE_SECRET --env production
```

`JWT_SECRET` and `DATA_ENCRYPTION_KEY` are required: the Worker answers 503 on
every route until both are set, and now until the rate-limit bindings are
present too.

**Do not set `ADMIN_EMAIL`, `ADMIN_PASSWORD` or `INITIAL_INVITE_CODE` on
production.** The seeding path refuses to run there regardless — see
`ensureSeeded` in `src/auth.ts` — but the variables have no business existing on
that Worker.

## 4. Still outstanding

The production origins are now set: `wrangler.jsonc` points `FRONTEND_ORIGIN`
and `PUBLIC_FORM_ORIGIN` at `https://aimz-egypt-production.pages.dev`, and
`mobile/eas.json` points the production build at
`https://aimz-api-production.shared-links.workers.dev`.

`workers_dev` is still `true` on production, so
`aimz-api-production.<subdomain>.workers.dev` answers alongside anything else.
Requests arriving there bypass zone-level WAF and firewall rules. It has to stay
`true` until a custom domain exists, or the API would be unreachable — so set
`workers_dev: false` **in the same change** that configures the custom domain,
never before it.
