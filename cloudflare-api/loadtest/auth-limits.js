/**
 * Proves the sign-in brakes do what they claim, and nothing more.
 *
 * Deliberately separate from `match-day.js`, and never run alongside it: this
 * script's whole purpose is to earn 429s, and a capacity test that meets one
 * is measuring the limiter rather than the database.
 *
 * It is tiny — a handful of virtual users for about three minutes — so it can
 * be run against staging freely. It makes no writes beyond the sessions a
 * successful sign-in creates, which the nightly purge clears.
 *
 *   k6 run loadtest/auth-limits.js \
 *     -e BASE=https://aimz-api-staging.shared-links.workers.dev \
 *     -e ACCOUNTS=./accounts.json
 *
 * WARNING: the IP-limiter phase spends this machine's whole login allowance
 * for a minute. Anybody signing in from the same address at that moment gets a
 * 429. Run it from the load generator, not from the office wifi, and not while
 * somebody is demonstrating the app.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE;
if (!BASE) throw new Error('Set BASE.');

const accounts = new SharedArray('accounts', () => {
  const parsed = JSON.parse(open(__ENV.ACCOUNTS || './accounts.json'));
  if (parsed.length < 12) throw new Error('The IP phase needs at least 12 accounts to stay clear of the per-account limit.');
  return parsed;
});

/** The configured limits, so a failure names which one moved. */
const LOGIN_PER_ACCOUNT = 10;
const LOGIN_PER_IP = 100;
const REFRESH_PER_TOKEN = 10;

const accountLimited = new Counter('account_limiter_fired');
const ipLimited = new Counter('ip_limiter_fired');
const refreshLimited = new Counter('refresh_limiter_fired');
const wrongly429 = new Counter('legitimate_request_refused');

export const options = {
  scenarios: {
    // One at a time: these phases interfere with each other by design.
    account_limiter: { executor: 'shared-iterations', vus: 1, iterations: 1, exec: 'accountLimiter', maxDuration: '2m' },
    refresh_rotation: { executor: 'shared-iterations', vus: 1, iterations: 1, exec: 'refreshRotation', startTime: '80s', maxDuration: '2m' },
    ip_limiter: { executor: 'shared-iterations', vus: 1, iterations: 1, exec: 'ipLimiter', startTime: '170s', maxDuration: '3m' },
  },
  thresholds: {
    // Each limiter must actually fire. A zero here means the binding is not
    // deployed, or the limit is not what we think it is.
    'account_limiter_fired': ['count>0'],
    'ip_limiter_fired': ['count>0'],
    'refresh_limiter_fired': ['count>0'],
    // And nothing legitimate may be refused.
    'legitimate_request_refused': ['count<1'],
  },
};

const post = (path, body, tag) => http.post(`${BASE}${path}`, JSON.stringify(body), {
  headers: { 'Content-Type': 'application/json' }, tags: { name: tag },
});

/**
 * Phase one: one account, tried repeatedly.
 *
 * A wrong password is used throughout, so this proves the brake without
 * needing a real one — the limiter is asked before the password is checked.
 */
export function accountLimiter() {
  const email = accounts[0].email;

  // The first attempt must be answered on its merits, not refused.
  const first = post('/api/v1/auth/login', { email, password: 'deliberately-wrong' }, 'login-account');
  check(first, { 'first attempt is judged, not refused': (r) => r.status === 401 });
  if (first.status === 429) wrongly429.add(1);

  let fired = 0;
  for (let attempt = 2; attempt <= LOGIN_PER_ACCOUNT + 4; attempt += 1) {
    const res = post('/api/v1/auth/login', { email, password: 'deliberately-wrong' }, 'login-account');
    if (res.status === 429) { fired += 1; accountLimited.add(1); }
    sleep(0.2);
  }
  check(null, { [`account limiter fired within ${LOGIN_PER_ACCOUNT + 4} attempts`]: () => fired > 0 });

  // And a real sign-in on a DIFFERENT account is untouched by it.
  const other = post('/api/v1/auth/login', accounts[1], 'login-other-account');
  check(other, { 'another account still signs in': (r) => r.status === 200 });
  if (other.status === 429) wrongly429.add(1);
}

/**
 * Phase two: rotation, then abuse of one token.
 *
 * Normal rotation must pass: every refresh returns a new token, so a client
 * refreshing on schedule never presents the same key twice. Presenting one key
 * over and over is the thing that gets stopped.
 */
export function refreshRotation() {
  const signIn = post('/api/v1/auth/login', accounts[2], 'login-refresh');
  check(signIn, { 'signed in for the refresh phase': (r) => r.status === 200 });
  if (signIn.status !== 200) return;

  // Rotation, as a real client does it — a new token each time.
  let refresh = signIn.json('refresh_token');
  for (let round = 0; round < 5; round += 1) {
    const res = post('/api/v1/auth/refresh', { refresh_token: refresh }, 'refresh-rotate');
    check(res, { 'rotation accepted': (r) => r.status === 200 });
    if (res.status === 429) wrongly429.add(1);
    if (res.status !== 200) return;
    refresh = res.json('refresh_token');
    sleep(0.3);
  }

  // The abusive shape: the same token, over and over. The first is spent
  // legitimately; the rest are replays and should be stopped.
  const replay = refresh;
  let fired = 0;
  for (let attempt = 0; attempt < REFRESH_PER_TOKEN + 4; attempt += 1) {
    const res = post('/api/v1/auth/refresh', { refresh_token: replay }, 'refresh-replay');
    if (res.status === 429) { fired += 1; refreshLimited.add(1); }
    sleep(0.2);
  }
  check(null, { 'refresh limiter fired on a replayed token': () => fired > 0 });
}

/**
 * Phase three: the address bucket.
 *
 * Spread across many accounts so the per-account limiter cannot be what fires.
 * This is the phase that briefly costs this address its login allowance.
 */
export function ipLimiter() {
  let fired = 0;
  for (let attempt = 0; attempt < LOGIN_PER_IP + 20; attempt += 1) {
    const account = accounts[attempt % accounts.length];
    const res = post('/api/v1/auth/login', { email: account.email, password: 'deliberately-wrong' }, 'login-ip');
    if (res.status === 429) { fired += 1; ipLimited.add(1); }
  }
  check(null, { [`address limiter fired within ${LOGIN_PER_IP + 20} attempts`]: () => fired > 0 });

  // Wait out the window, then confirm the address recovers on its own.
  sleep(65);
  const after = post('/api/v1/auth/login', accounts[3], 'login-after-cooldown');
  check(after, { 'the address recovers after a minute': (r) => r.status === 200 });
  if (after.status === 429) wrongly429.add(1);
}
