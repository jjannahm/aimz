/**
 * A match-day load test: what 1,000–2,000 families do at once.
 *
 * Run it against staging, never production, unless you have decided to and
 * know what a bad result would cost. Nothing here writes: every request is a
 * read, so a run cannot corrupt a register, a score or a fee. It will still
 * spend request quota, so read the note on cost below before starting.
 *
 *   npm i -g k6            # or: winget install k6 / brew install k6
 *   k6 run loadtest/match-day.js \
 *     -e BASE=https://aimz-api-staging.shared-links.workers.dev \
 *     -e EMAIL=loadtest@aimz.example -e PASSWORD='...' \
 *     -e MATCH_ID=<a finished or live match id> \
 *     -e PLAYER_ID=<a player on that squad>
 *
 * Cost of a full run: the peak stage below is ~1,500 users polling every 12s
 * for 10 minutes, which is roughly 750,000 requests. On the Workers paid plan
 * that is ~7.5% of a month's included requests. Start with SHAPE=smoke.
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE;
const EMAIL = __ENV.EMAIL;
const PASSWORD = __ENV.PASSWORD;
const MATCH_ID = __ENV.MATCH_ID;
const PLAYER_ID = __ENV.PLAYER_ID;

if (!BASE || !EMAIL || !PASSWORD) throw new Error('Set BASE, EMAIL and PASSWORD.');

/** The app polls a live match every twelve seconds; this mirrors that exactly. */
const POLL_SECONDS = 12;

const pollLatency = new Trend('poll_latency', true);
const coldReadLatency = new Trend('cold_read_latency', true);
const notModified = new Rate('polls_answered_304');
const quotaErrors = new Counter('quota_or_rate_limited');

/**
 * Three shapes. `smoke` proves the script works and costs almost nothing.
 * `ramp` is the real question — 1,500 concurrent viewers. `soak` is for
 * finding leaks and quota drift over an hour.
 */
const shapes = {
  smoke: { stages: [{ duration: '1m', target: 20 }] },
  ramp: {
    stages: [
      { duration: '2m', target: 300 },   // gentle: does anything wobble early
      { duration: '3m', target: 1000 },  // the number you asked about
      { duration: '5m', target: 1500 },  // headroom above it
      { duration: '10m', target: 1500 }, // hold — this is where the answer is
      { duration: '2m', target: 0 },
    ],
  },
  soak: { stages: [{ duration: '5m', target: 800 }, { duration: '55m', target: 800 }, { duration: '2m', target: 0 }] },
};

export const options = {
  scenarios: { matchday: { executor: 'ramping-vus', gracefulRampDown: '30s', ...shapes[__ENV.SHAPE || 'smoke'] } },
  thresholds: {
    // A poll is the request every viewer makes constantly. If this degrades,
    // everyone feels it at once.
    'poll_latency': ['p(95)<1500', 'p(99)<3000'],
    // Opening a screen for the first time is allowed to be slower.
    'cold_read_latency': ['p(95)<3000'],
    'http_req_failed': ['rate<0.01'],
    'quota_or_rate_limited': ['count<1'],
  },
};

/** One sign-in per virtual user, reused for the whole run — as a real app does. */
export function setup() {
  const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'signed in': (r) => r.status === 200 });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status} ${res.body}`);
  return { token: res.json('access_token') };
}

const authed = (token, extra = {}) => ({
  headers: { Authorization: `Bearer ${token}`, ...extra },
  tags: { name: 'authed' },
});

export default function (data) {
  const token = data.token;

  // What a parent actually does: opens the app, looks at the fixtures, then
  // sits on one match and lets it poll.
  group('opening the app', () => {
    const me = http.get(`${BASE}/api/v1/users/me`, authed(token));
    coldReadLatency.add(me.timings.duration);
    check(me, { 'me ok': (r) => r.status === 200 });

    const fixtures = http.get(`${BASE}/api/v1/matches?match_status=scheduled&limit=50`, authed(token));
    coldReadLatency.add(fixtures.timings.duration);
    check(fixtures, { 'fixtures ok': (r) => r.status === 200 });
  });

  if (PLAYER_ID) {
    group('reading a player', () => {
      const stats = http.get(`${BASE}/api/v1/players/${PLAYER_ID}/training-stats`, authed(token));
      coldReadLatency.add(stats.timings.duration);
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
      if (res.status === 429 || res.status === 503) quotaErrors.add(1);
      check(res, { 'poll ok': (r) => r.status === 200 || r.status === 304 });
      etag = res.headers['Etag'] || etag;
      sleep(POLL_SECONDS);
    }
  } else {
    sleep(POLL_SECONDS);
  }
}
