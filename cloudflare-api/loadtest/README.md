# Load testing AIMZ

Two scripts, deliberately separate:

- **`match-day.js`** — capacity. What happens when every family watches the
  same match. Read-only.
- **`auth-limits.js`** — the sign-in brakes. Its purpose is to earn 429s, so it
  must never run at the same time as the capacity test.

> **Paths in `-e ACCOUNTS=` are relative to the script**, not to your shell:
> k6's `open()` resolves from `loadtest/`. `./accounts.json` is correct;
> `./loadtest/accounts.json` looks right and is not.

## Accounts

Both scripts read a pool of staging logins from `accounts.json`, which is
git-ignored. Build it with the provisioner rather than by hand:

```bash
cd cloudflare-api
API_URL=https://aimz-api-staging.shared-links.workers.dev ADMIN_EMAIL=<staging admin> ADMIN_PASSWORD=<staging admin password> node scripts/provision-loadtest.mjs
```

It creates a squad, twenty players, a finished match with a real team sheet and
event thread, and twenty family logins linked to those players — then signs in
as each one and checks it can read the match and that the Hub returns no more
than fifty notices. It prints the `MATCH_ID` and `PLAYER_ID` to use, and never
prints a password. Re-run `--verify-only` any time to re-check the pool without
creating anything.

Each run mints a fresh batch (there is no endpoint to delete an account or
reset its password), so reruns leave inert staging rows behind. `accounts.json`
is overwritten with the newest batch.

**Minimum 20 accounts; 12 is the hard floor** (the IP phase of the auth test
needs enough accounts that the per-account limiter cannot be what fires).
More is better for realism, because each account's rows are read repeatedly.

Make them families of **one squad**, and test a match **that squad played** —
that is a real match day, and it means one `MATCH_ID` works for every VU.

VUs are distributed round robin: `tokens[(__VU - 1) % tokens.length]`. With 20
accounts, 1,500 VUs is 75 per account.

## How authentication works, exactly

| Question | Answer |
| --- | --- |
| Does every VU call `/auth/login`? | **No.** |
| Does every iteration? | **No.** |
| Is login done in `setup()`? | **Yes — once per pooled account, before the clock starts.** |
| Is one token shared by all VUs? | No. One token *per account*, shared by the VUs assigned to it. |
| Does each VU get its own token? | No — that would need 1,500 accounts. |
| Does it exercise refresh? | **No.** Rotation revokes the previous token, so VUs sharing an account would revoke each other's. Refresh is tested in `auth-limits.js`. |

Authentication is never bypassed: every request carries a real bearer token and
pays the full server cost — JWT verify, account read, scope read, visibility
check.

**Runs must finish inside 15 minutes**, the access-token lifetime. Every stage
below does. The `expired_tokens` threshold fails the run if a token dies
mid-test, so an expiry can never be mistaken for load.

## The capacity ladder

Run **in order**, reading each result before starting the next. Stop at the
first rung that fails a threshold — the rung below it is your answer.

```bash
export BASE=https://aimz-api-staging.shared-links.workers.dev
export MATCH_ID=...      # a match with a lineup and events
export PLAYER_ID=...     # a player on that squad
```

| Stage | Command |
| --- | --- |
| smoke | `k6 run loadtest/match-day.js -e SHAPE=smoke -e BASE=$BASE -e ACCOUNTS=./accounts.json -e MATCH_ID=$MATCH_ID -e PLAYER_ID=$PLAYER_ID` |
| 100 | `k6 run loadtest/match-day.js -e SHAPE=step -e VUS=100 -e HOLD=5m -e BASE=$BASE -e ACCOUNTS=./accounts.json -e MATCH_ID=$MATCH_ID -e PLAYER_ID=$PLAYER_ID` |
| 300 | `k6 run loadtest/match-day.js -e SHAPE=step -e VUS=300 -e HOLD=5m -e BASE=$BASE -e ACCOUNTS=./accounts.json -e MATCH_ID=$MATCH_ID -e PLAYER_ID=$PLAYER_ID` |
| 500 | `k6 run loadtest/match-day.js -e SHAPE=step -e VUS=500 -e HOLD=5m -e BASE=$BASE -e ACCOUNTS=./accounts.json -e MATCH_ID=$MATCH_ID -e PLAYER_ID=$PLAYER_ID` |
| 1,000 | `k6 run loadtest/match-day.js -e SHAPE=step -e VUS=1000 -e HOLD=8m -e BASE=$BASE -e ACCOUNTS=./accounts.json -e MATCH_ID=$MATCH_ID -e PLAYER_ID=$PLAYER_ID` |
| 1,500 | `k6 run loadtest/match-day.js -e SHAPE=step -e VUS=1500 -e HOLD=8m -e BASE=$BASE -e ACCOUNTS=./accounts.json -e MATCH_ID=$MATCH_ID -e PLAYER_ID=$PLAYER_ID` |

PowerShell: `$env:BASE = "..."`, then `-e BASE=$env:BASE`.

The auth test, separately and never concurrently:

```bash
k6 run loadtest/auth-limits.js -e BASE=$BASE -e ACCOUNTS=./accounts.json
```

## The load generator

**Do not run the upper rungs from a laptop.** At 1,500 VUs you would be
measuring your own machine and home connection.

| VUs | vCPU | RAM | Sockets (`ulimit -n`) | Sustained network |
| --- | --- | --- | --- | --- |
| 500 | 2 | 2 GB | 8,192 | ~1 MB/s |
| 1,000 | 4 | 4 GB | 16,384 | ~2 MB/s |
| 1,500 | 4–8 | 8 GB | 65,535 | ~3 MB/s |

k6 holds roughly 1–5 MB per VU and manages 300–1,000 simple VUs per core; this
script is light (a few requests, then a 12-second sleep), so it sits at the
generous end. **One VM is enough for 1,500** — e.g. AWS `c7i.xlarge`, GCP
`c3-highcpu-4`, or Hetzner `CCX23`, in a region near the API. Raise the socket
limit before starting:

```bash
ulimit -n 65535
```

### Preflight

On the VM, from the `loadtest` directory, after copying `accounts.json` across:

```bash
./preflight.sh https://aimz-api-staging.shared-links.workers.dev
```

It refuses a production-looking URL, then checks k6, vCPU, free RAM, the socket
limit (raising it for that shell where it can), the ephemeral port range, that
the API and its database answer, and that **every pooled account can sign in** —
paced so the burst never meets `LOGIN_BY_IP`. It stops at the first thing that
would make a run untrustworthy.

Getting the files across, without ever committing credentials:

```bash
scp cloudflare-api/loadtest/{match-day.js,auth-limits.js,preflight.sh,README.md} user@vm:~/loadtest/
scp cloudflare-api/loadtest/accounts.json user@vm:~/loadtest/accounts.json
```

### Telling generator problems apart from Cloudflare problems

The run fails on `dropped_iterations > 0` — k6 could not start iterations on
schedule, meaning it ran out of CPU. **A dropped iteration invalidates the
run.** Watch these together:

- `dropped_iterations` — must be 0.
- `iteration_duration` climbing while `http_req_duration` stays flat: the
  generator is the bottleneck, not the API.
- `http_req_blocked` / `http_req_connecting` rising: sockets or DNS on the
  generator, not server latency.
- `top` on the generator: k6 pinned near 100% of all cores means the numbers
  are about the VM.

Keep the raw series for comparing rungs: `k6 run --out json=run.json ...`.

## What to watch, and what a good result looks like

Record the **100-VU run as your baseline**; the shape across rungs matters more
than any single number.

| Metric | Where | Good | Worrying |
| --- | --- | --- | --- |
| `poll_latency` p95 | k6 | under ~1.5s, flat as VUs rise | climbing with concurrency — the ceiling |
| `http_req_failed` | k6 | under 1% | anything sustained |
| `polls_answered_304` | k6 | high once the match stops changing | low: the ETag path is not working |
| `expired_tokens` | k6 | 0 | any — the run is invalid, re-run shorter |
| `dropped_iterations` | k6 | 0 | any — the generator is saturated |
| Worker CPU p99 | Cloudflare | flat | rising means real CPU pressure |
| D1 query latency | Cloudflare | flat | rising is the true ceiling |
| 429 / 503 | both | none | rate limited, or a plan limit |

## What this deliberately does not test

- **Writes.** Live scoring, marking a register, saving a lineup — done by one or
  two coaches, not by a thousand people. They are the only thing that can lock,
  so they deserve their own test one day.
- **Sign-in storms.** A thousand people opening the app in the same minute is a
  different profile, and login is the most expensive endpoint (PBKDF2, 100k
  rounds). Worth its own test before a season launch.
- **The web app.** Static files on Pages; not the part that struggles.
