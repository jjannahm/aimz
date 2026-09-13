# Load testing AIMZ

`match-day.js` simulates the one moment that concentrates load: a match, with
every family watching it at once. Everything it does is a read.

## Before you run it

1. **Staging only**, unless you have decided otherwise deliberately. The script
   itself is read-only, but the traffic is real and spends request quota.
2. Make a **load-test account** — a player or parent login with a linked player
   — rather than using your own.
3. Pick a **match id** that has a lineup and some events, so the poll is
   answering a realistic payload, and a **player id** on that squad.
4. Start with `SHAPE=smoke`. Only move to `ramp` once the smoke run is clean.

```bash
k6 run loadtest/match-day.js -e SHAPE=smoke \
  -e BASE=https://aimz-api-staging.shared-links.workers.dev \
  -e EMAIL=loadtest@aimz.example -e PASSWORD='...' \
  -e MATCH_ID=... -e PLAYER_ID=...
```

## The ladder

Run these **in order**, and read the result of each before starting the next.
Stop at the first rung that fails a threshold — the number below it is your
answer, and going higher only tells you how much worse it gets.

Set these once:

```bash
export BASE=https://aimz-api-staging.shared-links.workers.dev
export EMAIL=loadtest@aimz.example
export PASSWORD='...'
export MATCH_ID=...      # a match with a lineup and some events
export PLAYER_ID=...     # a player on that squad
```

| Stage | Command |
| --- | --- |
| smoke | `k6 run loadtest/match-day.js -e SHAPE=smoke -e BASE=$BASE -e EMAIL=$EMAIL -e PASSWORD=$PASSWORD -e MATCH_ID=$MATCH_ID -e PLAYER_ID=$PLAYER_ID` |
| 100 | `k6 run loadtest/match-day.js -e SHAPE=step -e VUS=100 -e HOLD=5m -e BASE=$BASE -e EMAIL=$EMAIL -e PASSWORD=$PASSWORD -e MATCH_ID=$MATCH_ID -e PLAYER_ID=$PLAYER_ID` |
| 300 | `k6 run loadtest/match-day.js -e SHAPE=step -e VUS=300 -e HOLD=5m -e BASE=$BASE -e EMAIL=$EMAIL -e PASSWORD=$PASSWORD -e MATCH_ID=$MATCH_ID -e PLAYER_ID=$PLAYER_ID` |
| 500 | `k6 run loadtest/match-day.js -e SHAPE=step -e VUS=500 -e HOLD=5m -e BASE=$BASE -e EMAIL=$EMAIL -e PASSWORD=$PASSWORD -e MATCH_ID=$MATCH_ID -e PLAYER_ID=$PLAYER_ID` |
| 1,000 | `k6 run loadtest/match-day.js -e SHAPE=step -e VUS=1000 -e HOLD=10m -e BASE=$BASE -e EMAIL=$EMAIL -e PASSWORD=$PASSWORD -e MATCH_ID=$MATCH_ID -e PLAYER_ID=$PLAYER_ID` |
| 1,500 | `k6 run loadtest/match-day.js -e SHAPE=step -e VUS=1500 -e HOLD=10m -e BASE=$BASE -e EMAIL=$EMAIL -e PASSWORD=$PASSWORD -e MATCH_ID=$MATCH_ID -e PLAYER_ID=$PLAYER_ID` |

On Windows PowerShell use `$env:BASE = "..."` and `-e BASE=$env:BASE`.

Roughly what each rung costs in requests: 100 VUs × 5 min ≈ 12,500; 500 × 5 min
≈ 62,500; 1,500 × 10 min ≈ 750,000. The whole ladder is a little under a
million requests, which is ~10% of a month's included Workers requests.

## What to watch, and what a good result looks like

Watch these four while it runs. The first two are k6's; the last two are in the
Cloudflare dashboard (Workers → your worker → Metrics, and D1 → your database).

| Metric | Where | Good | Worrying |
| --- | --- | --- | --- |
| `poll_latency` p95 | k6 output | under ~1.5s | climbing as VUs rise — the API is queueing behind D1 |
| `http_req_failed` | k6 output | under 1% | anything sustained; check the status codes |
| `polls_answered_304` | k6 output | high once a match stops changing | low means the ETag path is not working and every poll is doing full work |
| Worker CPU time p99 | Cloudflare | flat as load rises | rising with concurrency means real CPU pressure, not just waiting |
| D1 query count / latency | Cloudflare | latency flat | latency rising with load is the ceiling you actually hit first |
| Errors 429 / 503 | both | none | you are being rate limited or have hit a plan limit |

**The shape of the result matters more than any single number.** Latency that
stays flat from 300 to 1,500 users means you have headroom above 1,500. Latency
that climbs steadily with concurrency means you have found the ceiling, and the
number where p95 crosses ~2s is your practical limit.

## What it deliberately does not test

- **Writes.** Live scoring, marking a register, saving a lineup. These are done
  by one or two coaches at a time, not by a thousand people, so they are not the
  concurrency question — but they are the only thing that can *lock*, so if you
  want a second test, that is the one to write.
- **Sign-in storms.** `setup()` logs in once. A thousand people opening the app
  in the same minute is a different profile, and login is the most CPU-expensive
  endpoint (PBKDF2, 100k iterations). Worth a separate small test before a
  season launch when everyone signs in at once.
- **The web app itself.** It is static files on Cloudflare Pages; it is not the
  part that struggles.
