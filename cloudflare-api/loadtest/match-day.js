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
// Split apart on purpose: a 429 is a brake working, a 503 is the Worker
// falling over, and a 0 is this machine failing to make the request at all.
// Counting them together once cost a whole run's diagnosis.
const rateLimited = new Counter('http_429_rate_limited');
const serverErrors = new Counter('http_503_server_error');
const otherServerErrors = new Counter('http_5xx_other');
const clientFailures = new Counter('client_side_failures');
const expiredTokens = new Counter('expired_tokens');
const forbidden = new Counter('http_403_forbidden');
/**
 * A couple of failure bodies per status code, from the first two VUs only.
 *
 * Per VU because each one has its own runtime and would otherwise print its
 * own five; per status because a 503 from our Worker and a 503 from the
 * platform look identical until you read them. Bodies only — no header is
 * printed, so no token can leak into a log.
 */
const seenPerStatus = {};

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
  // Every phase of a request, so a slow answer (waiting) can be told apart
  // from a generator that could not open a socket (blocked, connecting).
  summaryTrendStats: ['med', 'p(90)', 'p(95)', 'p(99)', 'max', 'avg'],
  scenarios: { matchday: { executor: 'ramping-vus', gracefulRampDown: '30s', ...(shapes[__ENV.SHAPE || 'smoke'] || shapes.smoke) } },
  thresholds: {
    // A poll is the request every viewer makes constantly. If this degrades,
    // everyone feels it at once.
    'poll_latency': ['p(95)<1500', 'p(99)<3000'],
    // Opening a screen for the first time is allowed to be slower.
    'cold_read_latency': ['p(95)<3000'],
    'http_req_failed': ['rate<0.01'],
    'http_429_rate_limited': ['count<1'],
    'http_503_server_error': ['count<1'],
    'http_5xx_other': ['count<1'],
    'client_side_failures': ['count<1'],
    'http_403_forbidden': ['count<1'],
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

/** Sorts every failure into the box that names its cause. */
function watch(res) {
  if (res.status === 200 || res.status === 304) return;
  if (res.status === 401) expiredTokens.add(1);
  else if (res.status === 403) forbidden.add(1);
  else if (res.status === 429) rateLimited.add(1);
  else if (res.status === 503) serverErrors.add(1);
  else if (res.status >= 500) otherServerErrors.add(1);
  // Status 0 is k6 itself: a connection refused, reset, or timed out before
  // any answer came back — the generator's problem, not the API's.
  else if (res.status === 0) clientFailures.add(1);

  // Because "503" alone does not say whether our Worker threw or the platform
  // shed the load — the bodies are quite different, and only one is our bug.
  if (__VU <= 2) {
    const seen = seenPerStatus[res.status] || 0;
    if (seen < 2) {
      seenPerStatus[res.status] = seen + 1;
      console.error(`FAILURE status=${res.status} err="${res.error || ""}" code=${res.error_code || 0} url=${String(res.request?.url || "").split("?")[0]} body=${String(res.body).slice(0, 240).replace(/\s+/gu, " ")}`);
    }
  }
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
