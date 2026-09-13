import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { openField, sealField, sealLegacyHealthData } from '../src/field-crypto';
import { app } from '../src/index';
import { createAccessToken, hashPassword } from '../src/security';

const testEnv = env as Env & { TEST_MIGRATIONS: string };
const now = new Date().toISOString();
const json = (method: string, body?: unknown, token?: string, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const request = (path: string, init?: RequestInit, bindings: Env = testEnv) => app.request(`http://aimz.test${path}`, init, bindings);
const unique = () => crypto.randomUUID().slice(0, 8);
/** A documentation-range address of its own, so one test's bucket is never another's. */
const freshAddress = () => `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function seedUser(role: 'admin' | 'player' | 'parent' | 'coach', playerId: string | null = null, password = 'unused') {
  const id = crypto.randomUUID();
  const email = `${id}@aimz.test`;
  await testEnv.DB.prepare('INSERT INTO users (id, name, email, password_hash, role, player_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .bind(id, `Test ${role}`, email, password === 'unused' ? 'unused' : await hashPassword(password), role, playerId, now, now).run();
  return { id, email, token: await createAccessToken(id, role, testEnv.JWT_SECRET, 900) };
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, JSON.parse(testEnv.TEST_MIGRATIONS));
});

/** Two squads in two leagues, a shared opponent, and a coach who runs the first. */
async function world() {
  const admin = await seedUser('admin');
  const tag = unique();
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const response = await request(path, json('POST', body, admin.token));
    expect(response.status, `${path}: ${await response.clone().text()}`).toBeLessThan(300);
    return response.json<T>();
  };
  const league = await post<{ id: string }>('/api/v1/competitions', { name: `Cairo League ${tag}`, season: '2026/27', type: 'league' });
  const other = await post<{ id: string }>('/api/v1/competitions', { name: `Delta League ${tag}`, season: '2026/27', type: 'league' });
  const mine = await post<Record<string, unknown> & { id: string }>('/api/v1/teams', { name: `AIMZ U13 ${tag}`, is_aimz: true, competition_id: league.id });
  const theirs = await post<{ id: string }>('/api/v1/teams', { name: `AIMZ U15 ${tag}`, is_aimz: true, competition_id: other.id });
  const rival = await post<{ id: string }>('/api/v1/teams', { name: `Cairo Comets ${tag}`, is_aimz: false });
  const myPlayer = await post<{ id: string }>('/api/v1/players', { name: 'Aya Nabil', team_id: mine.id, position: 'ST' });
  const theirPlayer = await post<{ id: string }>('/api/v1/players', { name: 'Amina Adel', team_id: theirs.id, position: 'ST' });
  const myMatch = await post<{ id: string }>('/api/v1/matches', { competition_id: league.id, home_team_id: mine.id, away_team_id: rival.id, kickoff_datetime: now, venue: 'Cairo', status: 'scheduled' });
  const theirMatch = await post<{ id: string }>('/api/v1/matches', { competition_id: other.id, home_team_id: theirs.id, away_team_id: rival.id, kickoff_datetime: now, venue: 'Tanta', status: 'scheduled' });
  const coach = await seedUser('coach');
  await testEnv.DB.prepare('INSERT INTO user_teams (user_id, team_id, created_at) VALUES (?, ?, ?)').bind(coach.id, mine.id, now).run();
  return { admin, tag, league, other, mine, theirs, rival, myPlayer, theirPlayer, myMatch, theirMatch, coach };
}

/** Plays a match to full time with one goal for the named player. */
async function playWithGoal(admin: { token: string }, matchId: string, teamId: string, playerId: string) {
  await request(`/api/v1/matches/${matchId}/lineup`, json('PUT', [{ player_id: playerId, team_id: teamId, is_starter: true, position: 'ST' }], admin.token));
  await request(`/api/v1/matches/${matchId}/phase`, json('POST', { action: 'start_match' }, admin.token));
  const goal = await request(`/api/v1/matches/${matchId}/events`, json('POST', { type: 'goal', minute: 10, team_id: teamId, player_id: playerId, client_operation_id: `goal-${matchId}` }, admin.token));
  expect(goal.status).toBe(201);
  for (const action of ['halftime', 'start_second_half', 'finish_match']) {
    await request(`/api/v1/matches/${matchId}/phase`, json('POST', { action }, admin.token));
  }
}

describe('every response', () => {
  it('carries headers that keep it from being framed, sniffed or leaked', async () => {
    const response = await request('/api/v1/health');
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    // Refusals too, not only successes.
    expect((await request('/api/v1/matches')).headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('refuses a body larger than any request the app sends', async () => {
    const response = await request('/api/v1/auth/login', json('POST', { email: 'big@aimz.test', password: 'x'.repeat(1_100_000) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ detail: { code: 'payload_too_large' } });
  });

  it('lets a local development origin call staging but never production', async () => {
    const preflight = (bindings: Env) => request('/api/v1/health', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8081', 'Access-Control-Request-Method': 'GET' } }, bindings);
    expect((await preflight(testEnv)).headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8081');
    const production = { ...testEnv, ENVIRONMENT: 'production' } as Env;
    expect((await preflight(production)).headers.get('Access-Control-Allow-Origin')).not.toBe('http://localhost:8081');
  });
});

describe('a production deployment', () => {
  it('answers 503 until its signing secret and encryption key are set', async () => {
    const unconfigured = { ...testEnv, ENVIRONMENT: 'production', DATA_ENCRYPTION_KEY: '' } as Env;
    const ready = await request('/api/v1/health/ready', undefined, unconfigured);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({ detail: { code: 'service_misconfigured' } });
    // Liveness still answers, so the platform does not restart a Worker that is merely waiting for a secret.
    expect((await request('/api/v1/health', undefined, unconfigured)).status).toBe(200);
    expect((await request('/api/v1/health/ready', undefined, { ...unconfigured, JWT_SECRET: 'short' } as Env)).status).toBe(503);

    const configured = { ...testEnv, ENVIRONMENT: 'production' } as Env;
    expect((await request('/api/v1/health/ready', undefined, configured)).status).toBe(200);
  });
});

/**
 * A stand-in for a rate limiting binding, which Miniflare does not provide: it
 * allows the first `allow` calls and records every key it is asked about, so a
 * test can check which bucket a request was counted in.
 */
function limiter(allow: number) {
  const keys: string[] = [];
  const binding = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: keys.length <= allow }; } };
  return { keys, binding: binding as unknown as RateLimit };
}

describe('the doors into an account', () => {
  it('limits invitation-code lookups from one address', async () => {
    const address = freshAddress();
    const invites = limiter(2);
    const bindings = { ...testEnv, INVITE_BY_IP: invites.binding } as Env;
    const lookup = () => request('/api/v1/auth/invitations/resolve', json('POST', { code: `NOPE-${unique()}` }, undefined, { 'CF-Connecting-IP': address }), bindings);
    expect((await lookup()).status).toBe(422);
    expect((await lookup()).status).toBe(422);
    const blocked = await lookup();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ detail: { code: 'rate_limited' } });
    expect(new Set(invites.keys)).toEqual(new Set([`invite-ip:${address}`]));
  });

  it('limits registrations from one address, since each one spends an invitation code', async () => {
    const address = freshAddress();
    const registrations = limiter(2);
    const bindings = { ...testEnv, REGISTER_BY_IP: registrations.binding } as Env;
    const register = () => request('/api/v1/auth/register', json('POST', { name: 'Someone', email: `r-${unique()}@aimz.test`, password: 'long-enough-password', invite_code: `GUESS-${unique()}` }, undefined, { 'CF-Connecting-IP': address }), bindings);
    expect((await register()).status).toBe(409);
    expect((await register()).status).toBe(409);
    expect((await register()).status).toBe(429);
    expect(new Set(registrations.keys)).toEqual(new Set([`register-ip:${address}`]));
  });

  it('limits current-password guesses on one account', async () => {
    const user = await seedUser('player', null, 'the-right-password');
    const guesses = limiter(2);
    const bindings = { ...testEnv, PASSWORD_BY_ACCOUNT: guesses.binding } as Env;
    const change = (current: string) => request('/api/v1/auth/password/change', json('POST', { current_password: current, new_password: 'another-long-password' }, user.token), bindings);
    expect((await change('guess-1')).status).toBe(422);
    expect((await change('guess-2')).status).toBe(422);
    // Even the right password waits once the account's budget is spent.
    expect((await change('the-right-password')).status).toBe(429);
    expect(new Set(guesses.keys)).toEqual(new Set([`password:${user.id}`]));
  });

  it('does not say whether an email has an account to somebody without an invitation', async () => {
    const existing = await seedUser('player');
    const response = await request('/api/v1/auth/register', json('POST', { name: 'Curious', email: existing.email, password: 'long-enough-password', invite_code: `MADE-UP-${unique()}` }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ detail: { code: 'invalid_invite' } });
  });

  it('spends a refresh token exactly once when two requests race it', async () => {
    const user = await seedUser('player', null, 'the-right-password');
    const session = await (await request('/api/v1/auth/login', json('POST', { email: user.email, password: 'the-right-password' }))).json<{ refresh_token: string }>();
    const [first, second] = await Promise.all([
      request('/api/v1/auth/refresh', json('POST', { refresh_token: session.refresh_token })),
      request('/api/v1/auth/refresh', json('POST', { refresh_token: session.refresh_token })),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 401]);
  });
});

describe('what an administrator creates', () => {
  it('names a new account’s role outright instead of defaulting to administrator', async () => {
    const admin = await seedUser('admin');
    const create = (role: unknown) => request('/api/v1/admin/users', json('POST', { name: 'New Person', email: `new-${unique()}@aimz.test`, password: 'long-enough-password', ...(role === undefined ? {} : { role }) }, admin.token));
    for (const role of [undefined, 'coach', 'Admin', 'superuser']) {
      const response = await create(role);
      expect(response.status, `role ${String(role)}`).toBe(422);
    }
    const player = await create('player');
    expect(player.status).toBe(201);
    expect(await player.json()).toMatchObject({ role: 'player' });
  });

  it('refuses an invitation deadline that is not a date still to come', async () => {
    const admin = await seedUser('admin');
    for (const expires_at of ['whenever', '2001-01-01T00:00:00.000Z']) {
      const response = await request('/api/v1/admin/registration-invites', json('POST', { label: 'Deadline', kind: 'newcomer', expires_at }, admin.token));
      expect(response.status, expires_at).toBe(422);
    }
  });
});

describe('a coach and the squad they run', () => {
  it('may rename it, but not enter it into a competition or change what it is', async () => {
    const { mine, other, coach, admin } = await world();
    expect((await request(`/api/v1/teams/${mine.id}`, json('PATCH', { name: 'Renamed by the coach' }, coach.token))).status).toBe(200);
    for (const change of [{ competition_id: other.id }, { is_aimz: false }, { is_active: false }]) {
      const response = await request(`/api/v1/teams/${mine.id}`, json('PATCH', change, coach.token));
      expect(response.status, JSON.stringify(change)).toBe(403);
      expect(await response.json()).toMatchObject({ detail: { code: 'admin_required' } });
    }
    // The whole record sent back unchanged, as the app's forms do, still saves.
    const current = await (await request(`/api/v1/teams?search=${encodeURIComponent('Renamed by the coach')}`, json('GET', undefined, admin.token))).json<{ items: Record<string, unknown>[] }>();
    expect((await request(`/api/v1/teams/${mine.id}`, json('PATCH', { ...current.items[0], coach: 'Coach Mona' }, coach.token))).status).toBe(200);
    expect((await request(`/api/v1/teams/${mine.id}`, json('PATCH', { competition_id: other.id }, admin.token))).status).toBe(200);
  });

  it('cannot move their own fixture onto squads they do not run', async () => {
    const { myMatch, theirs, rival, coach } = await world();
    const moved = await request(`/api/v1/matches/${myMatch.id}`, json('PATCH', { home_team_id: theirs.id, away_team_id: rival.id }, coach.token));
    expect(moved.status).toBe(403);
    expect(await moved.json()).toMatchObject({ detail: { code: 'team_access_denied' } });
  });

  it('cannot file a fixture into another league, but may arrange a friendly', async () => {
    const { mine, rival, other, coach, admin, tag } = await world();
    const fixture = (competitionId: string) => request('/api/v1/matches', json('POST', { competition_id: competitionId, home_team_id: mine.id, away_team_id: rival.id, kickoff_datetime: now, venue: 'Cairo', status: 'scheduled' }, coach.token));
    const intruding = await fixture(other.id);
    expect(intruding.status).toBe(403);
    expect(await intruding.json()).toMatchObject({ detail: { code: 'competition_access_denied' } });
    const friendlies = await (await request('/api/v1/competitions', json('POST', { name: `Friendlies ${tag}`, season: '2026/27', type: 'friendly' }, admin.token))).json<{ id: string }>();
    expect((await fixture(friendlies.id)).status).toBe(201);
  });

  it('cannot point a crest at anything but an uploaded image key', async () => {
    const { mine, coach, admin } = await world();
    for (const logo_key of ['../../secrets.txt', `players/${mine.id}/${crypto.randomUUID()}.png`, 'teams/x/not-a-uuid.png']) {
      expect((await request(`/api/v1/teams/${mine.id}`, json('PATCH', { logo_key }, coach.token))).status, logo_key).toBe(422);
    }
    expect((await request(`/api/v1/teams/${mine.id}`, json('PATCH', { logo_key: `teams/${mine.id}/${crypto.randomUUID()}.png` }, admin.token))).status).toBe(200);
  });
});

describe('reads held to the caller’s squad', () => {
  it('answers head-to-head only for teams the caller can open, counting only meetings they can see', async () => {
    const { admin, mine, theirs, rival, myPlayer, theirPlayer, myMatch, theirMatch } = await world();
    await playWithGoal(admin, myMatch.id, mine.id, myPlayer.id);
    await playWithGoal(admin, theirMatch.id, theirs.id, theirPlayer.id);
    const family = await seedUser('player', myPlayer.id);

    expect((await request(`/api/v1/teams/${theirs.id}/head-to-head/${rival.id}`, json('GET', undefined, family.token))).status).toBe(404);
    const own = await (await request(`/api/v1/teams/${mine.id}/head-to-head/${rival.id}`, json('GET', undefined, family.token))).json<{ played: number }>();
    expect(own.played).toBe(1);
    // The opponent's page shows only the meeting with the caller's own squad, never theirs with somebody else.
    const fromRival = await (await request(`/api/v1/teams/${rival.id}/head-to-head/${theirs.id}`, json('GET', undefined, family.token))).json<{ played: number }>();
    expect(fromRival.played).toBe(0);
    const asAdmin = await (await request(`/api/v1/teams/${theirs.id}/head-to-head/${rival.id}`, json('GET', undefined, admin.token))).json<{ played: number }>();
    expect(asAdmin.played).toBe(1);
  });

  it('ranks leaders only across the competitions the caller’s squad plays in', async () => {
    const { admin, mine, theirs, myPlayer, theirPlayer, myMatch, theirMatch } = await world();
    await playWithGoal(admin, myMatch.id, mine.id, myPlayer.id);
    await playWithGoal(admin, theirMatch.id, theirs.id, theirPlayer.id);
    const family = await seedUser('player', myPlayer.id);

    const ranked = async (token: string) => (await (await request('/api/v1/stats/leaders?metric=goals&limit=100', json('GET', undefined, token))).json<{ player: { id: string } }[]>()).map((row) => row.player.id);
    const seenByFamily = await ranked(family.token);
    expect(seenByFamily).toContain(myPlayer.id);
    expect(seenByFamily).not.toContain(theirPlayer.id);
    expect(await ranked(admin.token)).toEqual(expect.arrayContaining([myPlayer.id, theirPlayer.id]));
    expect(await (await request('/api/v1/stats/leaders', json('GET', undefined, (await seedUser('player')).token))).json()).toEqual([]);
  });
});

describe('uploaded images', () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

  async function presigned(admin: { token: string }, teamId: string) {
    const response = await request('/api/v1/media/uploads/presign', json('POST', { entity: 'team', entity_id: teamId, content_type: 'image/png' }, admin.token));
    return response.json<{ fields: Record<string, string>; object_key: string }>();
  }
  const upload = (fields: Record<string, string>, bytes: Uint8Array) => {
    const form = new FormData();
    for (const [field, value] of Object.entries(fields)) form.append(field, value);
    form.append('file', new File([bytes], 'crest.png', { type: 'image/png' }));
    return request('/api/v1/media/uploads', { method: 'POST', body: form });
  };

  it('refuses a file that is not the image it claims to be', async () => {
    const { admin, mine } = await world();
    const page = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    const refused = await upload((await presigned(admin, mine.id)).fields, page);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ detail: { code: 'invalid_image' } });
  });

  it('serves only the keys it issues, sandboxed and readable by the app', async () => {
    const { admin, mine } = await world();
    const slot = await presigned(admin, mine.id);
    expect((await upload(slot.fields, png)).status).toBe(204);
    const image = await request(`/api/v1/media/${slot.object_key}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(image.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(image.headers.get('Content-Disposition')).toBe('inline');
    expect((await request('/api/v1/media/anything/else.png')).status).toBe(404);
    expect((await request('/api/v1/media/%E0%A4%A')).status).toBe(404);
  });

  it('refuses a presign whose id could not be part of a key', async () => {
    const { admin } = await world();
    const response = await request('/api/v1/media/uploads/presign', json('POST', { entity: 'team', entity_id: '../players', content_type: 'image/png' }, admin.token));
    expect(response.status).toBe(404);
  });
});

describe('health notes at rest', () => {
  const application = (name: string, email: string) => ({
    branch: 'Maadi', full_name: name, mobile: '0100', email, whatsapp_mobile: '0100',
    date_of_birth: '2014-05-02', nationality: 'Egyptian', address: 'Cairo', previous_academy: 'None',
    school_university: 'School', father_name: 'Hossam', father_mobile: '0101', mother_name: 'Mona',
    mother_mobile: '0102', medical_concerns: 'Asthma; uses an inhaler before running', medications: 'Salbutamol', consent: true,
  });

  it('are stored sealed and opened only for an administrator', async () => {
    const admin = await seedUser('admin');
    const invite = await (await request('/api/v1/admin/registration-invites', json('POST', { label: 'Intake', kind: 'newcomer' }, admin.token))).json<{ code: string }>();
    const email = `sealed-${unique()}@aimz.test`;
    const created = await request('/api/v1/auth/register', json('POST', { name: 'Salma Nour', email, password: 'long-enough-password', invite_code: invite.code, application: application('Salma Nour', email) }));
    expect(created.status, await created.clone().text()).toBe(201);

    const stored = await testEnv.DB.prepare('SELECT id, medical_concerns, medications FROM newcomer_applications WHERE email = ?').bind(email).first<{ id: string; medical_concerns: string; medications: string }>();
    expect(stored!.medical_concerns.startsWith('enc:v1:')).toBe(true);
    expect(stored!.medical_concerns).not.toContain('Asthma');
    expect(stored!.medications).not.toContain('Salbutamol');

    const read = await (await request(`/api/v1/admin/newcomers/${stored!.id}`, json('GET', undefined, admin.token))).json<{ medical_concerns: string; medications: string }>();
    expect(read).toMatchObject({ medical_concerns: 'Asthma; uses an inhaler before running', medications: 'Salbutamol' });
    const listed = await (await request('/api/v1/admin/newcomers?limit=100', json('GET', undefined, admin.token))).json<{ items: { id: string; medications: string }[] }>();
    expect(listed.items.find((item) => item.id === stored!.id)?.medications).toBe('Salbutamol');
  });

  it('are refused past the length the public form allows', async () => {
    const admin = await seedUser('admin');
    const invite = await (await request('/api/v1/admin/registration-invites', json('POST', { label: 'Intake', kind: 'newcomer' }, admin.token))).json<{ code: string }>();
    const email = `long-${unique()}@aimz.test`;
    const response = await request('/api/v1/auth/register', json('POST', { name: 'Long Notes', email, password: 'long-enough-password', invite_code: invite.code, application: { ...application('Long Notes', email), medications: 'x'.repeat(4001) } }));
    expect(response.status).toBe(422);
  });

  it('written before the key was set are sealed by the nightly timer', async () => {
    const admin = await seedUser('admin');
    const id = crypto.randomUUID();
    await testEnv.DB.prepare(`INSERT INTO newcomer_applications
      (id,source,stage,branch,full_name,mobile,email,whatsapp_mobile,date_of_birth,nationality,address,
       previous_academy,school_university,father_name,father_mobile,mother_name,mother_mobile,
       medical_concerns,medications,consent_version,consented_at,created_at,updated_at)
      VALUES(?,'public_link','new','Maadi','Legacy Row','0100',?,'0100','2014-05-02','Egyptian','Cairo',
             'None','School','Hossam','0101','Mona','0102','Peanut allergy','EpiPen','2026-09',?,?,?)`)
      .bind(id, `legacy-${unique()}@aimz.test`, now, now, now).run();

    expect(await sealLegacyHealthData(testEnv)).toBeGreaterThan(0);
    const stored = await testEnv.DB.prepare('SELECT medical_concerns, medications FROM newcomer_applications WHERE id = ?').bind(id).first<{ medical_concerns: string; medications: string }>();
    expect(stored!.medical_concerns.startsWith('enc:v1:')).toBe(true);
    expect(await (await request(`/api/v1/admin/newcomers/${id}`, json('GET', undefined, admin.token))).json()).toMatchObject({ medical_concerns: 'Peanut allergy', medications: 'EpiPen' });
    // A second run finds nothing left to seal.
    expect(await sealLegacyHealthData(testEnv)).toBe(0);
  });
});

describe('the sealed format shared with the FastAPI backend', () => {
  // Sealed by backend/app/core/field_crypto.py with this key. The backend's
  // tests open a value this Worker sealed, so an export imports either way.
  const bindings = { ...testEnv, DATA_ENCRYPTION_KEY: 'cross-implementation-test-key-0123456789abcdef' } as Env;
  const fromPython = 'enc:v1:e3flrfCN_tAlcBGDWWVyLf3GkGZSm__MzD_CtRhBuHk9GjnEiqDyjn_NKv6ze_zS7369ul2pIw';

  it('opens what the backend sealed, and only in the column it was sealed for', async () => {
    expect(await openField(bindings, 'newcomer_applications.medications', fromPython)).toBe('Salbutamol inhaler, 2 puffs');
    expect(await openField(bindings, 'newcomer_applications.medical_concerns', fromPython)).toBe(fromPython);
    expect(await openField({ ...bindings, DATA_ENCRYPTION_KEY: 'a-different-key-that-is-also-long-enough' } as Env, 'newcomer_applications.medications', fromPython)).toBe(fromPython);
  });

  it('never seals the same text to the same value twice', async () => {
    const first = await sealField(bindings, 'newcomer_applications.medications', 'None');
    const second = await sealField(bindings, 'newcomer_applications.medications', 'None');
    expect(first).not.toBe(second);
  });
});

describe('calendar text typed by staff', () => {
  it('cannot start a property of its own with a stray carriage return', async () => {
    const admin = await seedUser('admin');
    const tag = unique();
    const squad = await (await request('/api/v1/teams', json('POST', { name: `AIMZ U11 ${tag}`, is_aimz: true }, admin.token))).json<{ id: string }>();
    const child = await (await request('/api/v1/players', json('POST', { name: 'Hana Samir', team_id: squad.id, position: 'CM' }, admin.token))).json<{ id: string }>();
    const created = await request('/api/v1/training-sessions', json('POST', {
      team_id: squad.id, venue: 'AIMZ Ground\rSUMMARY:Injected', notes: 'Bring boots\rBEGIN:VALARM', duration_minutes: 60,
      occurrences: [new Date(Date.now() + 86_400_000).toISOString()],
    }, admin.token));
    expect(created.status, await created.clone().text()).toBe(201);
    await request('/api/v1/admin/registration-invites', json('POST', { label: 'Samir family', code: `SAMIR-${tag}`, kind: 'parent', player_ids: [child.id] }, admin.token));
    const parent = await (await request('/api/v1/auth/register', json('POST', { name: 'Samir Hany', email: `ics-${tag}@aimz.test`, password: 'long-enough-password', invite_code: `SAMIR-${tag}` }))).json<{ access_token: string }>();
    const feed = await (await request('/api/v1/users/me/calendar', json('POST', {}, parent.access_token))).json<{ url: string }>();
    const ics = (await (await request(new URL(feed.url).pathname)).text()).replace(/\r\n /gu, '');

    expect(ics).not.toMatch(/\r(?!\n)/u);
    const lines = ics.split('\r\n');
    expect(lines).not.toContain('SUMMARY:Injected');
    expect(lines).not.toContain('BEGIN:VALARM');
    expect(lines).toContain('LOCATION:AIMZ Ground\\nSUMMARY:Injected');
  });
});
