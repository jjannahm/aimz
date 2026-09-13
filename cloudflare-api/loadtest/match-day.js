/**
 * A match-day load test: what 1,000–2,000 families do at once.
 *
 * This measures the application under load. It is not an auth test — that is
 * `auth-limits.js`, and the two must not run at the same time.
 *
 * AUTHENTICATION, precisely, because it decides whether the numbers mean
 * anything:
 *
 *   - `setup()` signs in ONCE PER POOLED ACCOUNT, before the clock starts.
 *     That is `accounts.length` logins for the whole run — not one per VU, and
 *     not one per iteration.
 *   - Each VU is handed one pooled account's access token, chosen round robin
 *     by VU number, and reuses it for the whole run.
 *   - No VU ever calls `/auth/login` again, so `LOGIN_BY_ACCOUNT` (10/60s) is
 *     never approached and cannot turn a capacity test into a 429 test.
 *   - Nothing here exercises refresh. Rotation revokes the previous token, and
 *     VUs sharing an account would revoke each other's; refresh is tested on
 *     its own in `auth-limits.js`.
 *   - Authentication is NOT bypassed. Every request carries a real bearer
 *     token and pays the full server cost: JWT verify, the account read, the
 *     scope read, and the visibility check.
 *
 * Access tokens live 15 minutes (`ACCESS_TOKEN_SECONDS`), so a run has to
 * finish inside that window. Every stage below does. `expired_tokens` counts
 * any 401 so an expiry can never be misread as load.
 *
 * Nothing here writes: every request is a read, so a run cannot corrupt a
 * register, a score or a fee. It does spend request quota — see the README.
 *
 *   k6 run loadtest/match-day.js -e SHAPE=smoke \
 *     -e BASE=https://aimz-api-staging.shared-links.workers.dev \
 *     -e ACCOUNTS=./accounts.json -e MATCH_ID=... -e PLAYER_ID=...
 *
 * `accounts.json` is a list of staging logins, and is git-ignored:
 *   [{ "email": "load01@aimz.example", "password": "..." }, ...]
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE;
const MATCH_ID = __ENV.MATCH_ID;
const PLAYER_ID = __ENV.PLAYER_ID;

if (!BASE) throw new Error('Set BASE.');

/** The app polls a live match every twelve seconds; this mirrors that exactly. */
const POLL_SECONDS = 12;

/** Parsed once for the whole run rather than once per VU. */
const accounts = new SharedArray('accounts', () => {
  const parsed = JSON.parse(open(__ENV.ACCOUNTS || './accounts.json'));
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('ACCOUNTS must be a non-empty array of { email, password }.');
  return parsed;
});

const pollLatency = new Trend('poll_latency', true);
const coldReadLatency = new Trend('cold_read_latency', true);
const notModified = new Rate('polls_answered_304');
const quotaErrors = new Counter('quota_or_rate_limited');
const expiredTokens = new Counter('expired_tokens');

const VUS = Number(__ENV.VUS || 20);
const HOLD = __ENV.HOLD || '5m';

const shapes = {
  // One rung of the ladder: ramp to VUS, hold, ramp down. Run these in order,
  // reading the result of each before starting the next.
  step: {
    stages: [
      { duration: '1m', target: VUS },
      { duration: HOLD, target: VUS },
      { duration: '30s', target: 0 },
    ],
  },
  smoke: { stages: [{ duration: '1m', target: 20 }] },
  // The whole ladder in one run, for when the rungs have already passed. Kept
  // under fifteen minutes so the pooled tokens outlive it.
  ramp: {
    stages: [
      { duration: '2m', target: 300 },
      { duration: '3m', target: 1000 },
      { duration: '4m', target: 1500 },
      { duration: '4m', target: 1500 },
      { duration: '1m', target: 0 },
    ],
  },
};

export const options = {
  scenarios: { matchday: { executor: 'ramping-vus', gracefulRampDown: '30s', ...(shapes[__ENV.SHAPE || 'smoke'] || shapes.smoke) } },
  thresholds: {
    // A poll is the request every viewer makes constantly. If this degrades,
    // everyone feels it at once.
    'poll_latency': ['p(95)<1500', 'p(99)<3000'],
    // Opening a screen for the first time is allowed to be slower.
    'cold_read_latency': ['p(95)<3000'],
    'http_req_failed': ['rate<0.01'],
    'quota_or_rate_limited': ['count<1'],
    // A token that expired mid-run makes every number after it meaningless.
    'expired_tokens': ['count<1'],
    // k6's own health: iterations it could not start on time, which means the
    // generator ran out of CPU. Any of these and the run is measuring the load
    // generator rather than Cloudflare.
    'dropped_iterations': ['count<1'],
  },
};

/**
 * One sign-in per pooled account, before the clock starts.
 *
 * Sequential and deliberately unhurried: a burst of logins from a single
 * address would meet `LOGIN_BY_IP` (100/60s), which is exactly the confusion
 * this whole design exists to avoid.
 */
export function setup() {
  const tokens = [];
  for (const account of accounts) {
    const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify(account), {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'setup-login' },
    });
    if (res.status !== 200) throw new Error(`Login failed for ${account.email}: ${res.status} ${res.body}`);
    tokens.push(res.json('access_token'));
    sleep(0.5);
  }
  console.log(`signed in ${tokens.length} pooled accounts`);
  return { tokens };
}

const authed = (token, extra = {}) => ({ headers: { Authorization: `Bearer ${token}`, ...extra } });

/** Counts the two answers that would silently invalidate the run. */
function watch(res) {
  if (res.status === 401) expiredTokens.add(1);
  if (res.status === 429 || res.status === 503) quotaErrors.add(1);
}

export default function (data) {
  // Round robin, so a pool of twenty spreads fifteen hundred VUs evenly and the
  // database is not answering every question about one family.
  const token = data.tokens[(__VU - 1) % data.tokens.length];

  // What a parent actually does: opens the app, glances at the fixtures and the
  // Hub, then sits on one match and lets it poll.
  group('opening the app', () => {
    const me = http.get(`${BASE}/api/v1/users/me`, authed(token));
    coldReadLatency.add(me.timings.duration); watch(me);
    check(me, { 'me ok': (r) => r.status === 200 });

    const fixtures = http.get(`${BASE}/api/v1/matches?match_status=scheduled&limit=50`, authed(token));
    coldReadLatency.add(fixtures.timings.duration); watch(fixtures);
    check(fixtures, { 'fixtures ok': (r) => r.status === 200 });

    // The read every family makes, and the one now bounded to a single page.
    const hub = http.get(`${BASE}/api/v1/announcements?limit=50`, authed(token));
    coldReadLatency.add(hub.timings.duration); watch(hub);
    check(hub, { 'announcements ok': (r) => r.status === 200 });
  });

  if (PLAYER_ID) {
    group('reading a player', () => {
      const stats = http.get(`${BASE}/api/v1/players/${PLAYER_ID}/training-stats`, authed(token));
      coldReadLatency.add(stats.timings.duration); watch(stats);
      check(stats, { 'training stats ok': (r) => r.status === 200 });
    });
  }

  // The expensive part of a match day: everybody polling the same match.
  if (MATCH_ID) {
    let etag = null;
    for (let i = 0; i < 5; i += 1) {
      const res = http.get(`${BASE}/api/v1/matches/${MATCH_ID}/live`, authed(token, etag ? { 'If-None-Match': etag } : {}));
      pollLatency.add(res.timings.duration);
      notModified.add(res.status === 304);
      watch(res);
      check(res, { 'poll ok': (r) => r.status === 200 || r.status === 304 });
      etag = res.headers['Etag'] || etag;
      sleep(POLL_SECONDS);
    }
  } else {
    sleep(POLL_SECONDS);
  }
}
