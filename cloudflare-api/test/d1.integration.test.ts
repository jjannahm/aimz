import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import app from '../src/index';
import { createAccessToken } from '../src/security';

const testEnv = env as Env & { TEST_MIGRATIONS: string };
const now = '2026-08-25T10:00:00.000Z';
const json = (method: string, body?: unknown, token?: string): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const request = (path: string, init?: RequestInit) => app.request(`http://aimz.test${path}`, init, testEnv);

const ROLE_NAMES = { admin: 'Test Admin', player: 'Test Player', parent: 'Test Parent' } as const;

async function seedUser(role: 'admin' | 'player' | 'parent', playerId: string | null = null): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  await testEnv.DB.prepare('INSERT INTO users (id, name, email, password_hash, role, player_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .bind(id, ROLE_NAMES[role], `${id}@aimz.test`, 'unused', role, playerId, now, now).run();
  return { id, token: await createAccessToken(id, role, testEnv.JWT_SECRET, 900) };
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, JSON.parse(testEnv.TEST_MIGRATIONS));
});

describe('D1 migrations and opponent results', () => {
  it('applies the numbered migration chain and uses result as the only score path', async () => {
    const applied = await testEnv.DB.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>();
    expect(applied.results.at(-1)?.name).toBe('0031_training_performance.sql');
    expect(applied.results.map((row) => row.name)).toContain('0013_invite_player_link.sql');

    const admin = await seedUser('admin');
    const competition = await (await request('/api/v1/competitions', json('POST', { name: 'Opponent League', season: '2026/27', type: 'league' }, admin.token))).json<{ id: string }>();
    const home = await (await request('/api/v1/teams', json('POST', { name: 'Cairo Comets', is_aimz: false }, admin.token))).json<{ id: string }>();
    const away = await (await request('/api/v1/teams', json('POST', { name: 'Nile Stars', is_aimz: false }, admin.token))).json<{ id: string }>();
    const matchResponse = await request('/api/v1/matches', json('POST', { competition_id: competition.id, home_team_id: home.id, away_team_id: away.id, kickoff_datetime: now, venue: 'Cairo Stadium', status: 'scheduled' }, admin.token));
    expect(matchResponse.status).toBe(201);
    const match = await matchResponse.json<{ id: string }>();

    const result = await request(`/api/v1/matches/${match.id}/result`, json('POST', { home_score: 2, away_score: 1 }, admin.token));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ home_score: 2, away_score: 1, status: 'finished', phase: 'finished', revision: 1 });
    const correction = await request(`/api/v1/matches/${match.id}/result`, json('POST', { home_score: 1, away_score: 3 }, admin.token));
    expect(await correction.json()).toMatchObject({ home_score: 1, away_score: 3, revision: 2 });

    for (const guarded of [
      request(`/api/v1/matches/${match.id}/events`, json('POST', { type: 'goal', minute: 5, team_id: home.id, client_operation_id: 'opponent-integration-event' }, admin.token)),
      request(`/api/v1/matches/${match.id}/lineup`, json('PUT', [], admin.token)),
      request(`/api/v1/matches/${match.id}/player-stats`, json('PUT', [], admin.token)),
      request(`/api/v1/matches/${match.id}/phase`, json('POST', { action: 'start_match' }, admin.token)),
      request(`/api/v1/matches/${match.id}/man-of-the-match`, json('POST', { player_id: null }, admin.token)),
    ]) {
      const response = await guarded;
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ detail: { code: 'opponent_only_match' } });
    }
    const table = await (await request(`/api/v1/competitions/${competition.id}/standings`, json('GET', undefined, admin.token))).json<{ team: { id: string }; points: number }[]>();
    expect(table.find((row) => row.team.id === away.id)?.points).toBe(3);
    const audits = await testEnv.DB.prepare("SELECT action FROM audit_log WHERE match_id = ? AND action = 'result_entered'").bind(match.id).all();
    expect(audits.results).toHaveLength(2);
  });
});

describe('team hub authorization and roster privacy', () => {
  it('scopes training, deduplicates RSVP, supports assignments, and hides private details', async () => {
    const admin = await seedUser('admin');
    const team = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U14', is_aimz: true }, admin.token))).json<{ id: string }>();
    const otherTeam = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U16', is_aimz: true }, admin.token))).json<{ id: string }>();
    const player = await (await request('/api/v1/players', json('POST', { name: 'Mariam', team_id: team.id, position: 'ST' }, admin.token))).json<{ id: string }>();
    const otherPlayer = await (await request('/api/v1/players', json('POST', { name: 'Nadine', team_id: otherTeam.id, position: 'GK' }, admin.token))).json<{ id: string }>();
    const playerUser = await seedUser('player', player.id);
    const otherPlayerUser = await seedUser('player', otherPlayer.id);

    const created = await request('/api/v1/training-sessions', json('POST', { team_id: team.id, venue: 'AIMZ Ground', notes: null, duration_minutes: 90, occurrences: ['2026-08-25T15:00:00.000Z', '2026-08-27T15:00:00.000Z'] }, admin.token));
    expect(created.status).toBe(201);
    const sessions = await created.json<{ id: string; series_id: string }[]>();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.series_id).toBe(sessions[1]?.series_id);

    const firstRsvp = await request(`/api/v1/training-sessions/${sessions[0]!.id}/availability`, json('PUT', { status: 'going', note: null }, playerUser.token));
    expect(firstRsvp.status).toBe(200);
    await request(`/api/v1/training-sessions/${sessions[0]!.id}/availability`, json('PUT', { status: 'not_going', note: 'School' }, playerUser.token));
    const rsvps = await (await request(`/api/v1/training-sessions/${sessions[0]!.id}/availability`, json('GET', undefined, playerUser.token))).json<{ status: string; note: string }[]>();
    expect(rsvps).toEqual([expect.objectContaining({ status: 'not_going', note: 'School' })]);
    // Availability is a two-way answer; "maybe" is no longer one of them.
    const undecided = await request(`/api/v1/training-sessions/${sessions[0]!.id}/availability`, json('PUT', { status: 'maybe', note: null }, playerUser.token));
    expect(undecided.status).toBe(422);

    const slot = await request(`/api/v1/training-sessions/${sessions[0]!.id}/assignments`, json('POST', { title: 'Bring bibs', assigned_player_id: null }, admin.token));
    expect(slot.status).toBe(201);
    const assignment = await slot.json<{ id: string }>();
    const claim = await request(`/api/v1/event-assignments/${assignment.id}`, json('PATCH', { assigned_player_id: player.id }, playerUser.token));
    expect(await claim.json()).toMatchObject({ assigned_player_id: player.id });
    const release = await request(`/api/v1/event-assignments/${assignment.id}`, json('PATCH', { assigned_player_id: null }, playerUser.token));
    expect(await release.json()).toMatchObject({ assigned_player_id: null });

    await request('/api/v1/announcements', json('POST', { team_id: null, title: 'Academy update', body: 'For everyone', pinned: false }, admin.token));
    const targeted = await request('/api/v1/announcements', json('POST', { team_id: team.id, title: 'U14 priority', body: 'Meet early', pinned: true }, admin.token));
    expect(await targeted.json()).toMatchObject({ team_id: team.id, team: { id: team.id } });
    await request('/api/v1/announcements', json('POST', { team_id: otherTeam.id, title: 'U16 only', body: 'Different squad', pinned: true }, admin.token));
    const visible = await (await request('/api/v1/announcements?limit=100', json('GET', undefined, playerUser.token))).json<{ items: { title: string; pinned: boolean; author_name: string }[] }>();
    expect(visible.items.map((announcement) => announcement.title)).toEqual(['U14 priority', 'Academy update']);
    expect(visible.items[0]).toMatchObject({ pinned: true, author_name: 'Test Admin' });
    const visibleToOtherTeam = await (await request('/api/v1/announcements?limit=100', json('GET', undefined, otherPlayerUser.token))).json<{ items: { title: string }[] }>();
    expect(visibleToOtherTeam.items.map((announcement) => announcement.title)).toEqual(['U16 only', 'Academy update']);
    const crossTeamFeed = await request(`/api/v1/announcements?team_id=${team.id}&limit=100`, json('GET', undefined, otherPlayerUser.token));
    expect(crossTeamFeed.status).toBe(403);
    expect(await crossTeamFeed.json()).toMatchObject({ detail: { code: 'team_access_denied' } });

    const accounts = await (await request('/api/v1/admin/users?limit=100', json('GET', undefined, admin.token))).json<{ items: { id: string; player: { id: string } | null; team: { id: string } | null }[] }>();
    expect(accounts.items.find((account) => account.id === playerUser.id)).toMatchObject({ player: { id: player.id }, team: { id: team.id } });
    const unlinked = await seedUser('player');
    const conflict = await request(`/api/v1/admin/users/${unlinked.id}`, json('PATCH', { player_id: player.id }, admin.token));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ detail: { code: 'player_already_linked' } });

    const invitedPlayer = await (await request('/api/v1/players', json('POST', { name: 'Nour', team_id: team.id, position: 'GK' }, admin.token))).json<{ id: string }>();
    const invite = await request('/api/v1/admin/registration-invites', json('POST', { label: 'Nour personal', code: 'NOUR-PERSONAL', player_id: invitedPlayer.id, max_uses: 20 }, admin.token));
    expect(await invite.json()).toMatchObject({ player_id: invitedPlayer.id, max_uses: 1 });
    const secondInvite = await request('/api/v1/admin/registration-invites', json('POST', { label: 'Nour spare', code: 'NOUR-SPARE', player_id: invitedPlayer.id }, admin.token));
    expect(secondInvite.status).toBe(201);
    const registered = await request('/api/v1/auth/register', json('POST', { name: 'Nour Login', email: 'nour@aimz.test', password: 'long-secure-password', invite_code: 'NOUR-PERSONAL' }));
    expect(registered.status).toBe(201);
    expect(await registered.json()).toMatchObject({ user: { player_id: invitedPlayer.id } });
    const spareClaim = await request('/api/v1/auth/register', json('POST', { name: 'Race Loser', email: 'race@aimz.test', password: 'long-secure-password', invite_code: 'NOUR-SPARE' }));
    expect(spareClaim.status).toBe(409);
    expect(await spareClaim.json()).toMatchObject({ detail: { code: 'player_already_linked' } });

    const privateWrite = await request(`/api/v1/players/${player.id}/contacts`, json('PUT', { date_of_birth: '2012-05-09', contacts: [{ name: 'Guardian', relationship: 'Parent', email: 'guardian@example.test', phone: '+201000000000' }] }, admin.token));
    expect(privateWrite.status).toBe(200);
    expect(await privateWrite.json()).toMatchObject({ date_of_birth: '2012-05-09', contacts: [{ name: 'Guardian' }] });
    expect((await request(`/api/v1/players/${player.id}/contacts`, json('GET', undefined, playerUser.token))).status).toBe(403);
    const publicPlayers = await (await request('/api/v1/players?limit=100', json('GET', undefined, playerUser.token))).json<{ items: Record<string, unknown>[] }>();
    expect(publicPlayers.items[0]).not.toHaveProperty('date_of_birth');
    expect(JSON.stringify(publicPlayers)).not.toContain('guardian@example.test');

    const deleteSeries = await request(`/api/v1/training-sessions/${sessions[0]!.id}?scope=series`, json('DELETE', undefined, admin.token));
    expect(deleteSeries.status).toBe(204);
    const afterDelete = await (await request('/api/v1/training-sessions?limit=100', json('GET', undefined, admin.token))).json<{ items: unknown[] }>();
    expect(afterDelete.items).toHaveLength(0);
  });
});

// A parent account is the one role that reaches the roster through a join table
// rather than through users.player_id, and it is the only one whose role value
// was added after the users table was written. Both are covered here: the whole
// feature shipped working and unusable because nothing registered a parent.
describe('parent accounts', () => {
  it('registers one account against several children and reads them back', async () => {
    const admin = await seedUser('admin');
    const younger = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U9', is_aimz: true }, admin.token))).json<{ id: string }>();
    const older = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U13', is_aimz: true }, admin.token))).json<{ id: string }>();
    const salma = await (await request('/api/v1/players', json('POST', { name: 'Salma Nabil', team_id: younger.id, position: 'ST' }, admin.token))).json<{ id: string }>();
    const mariam = await (await request('/api/v1/players', json('POST', { name: 'Mariam Adel', team_id: older.id, position: 'GK' }, admin.token))).json<{ id: string }>();

    const invite = await request('/api/v1/admin/registration-invites', json('POST', { label: 'Nabil family', code: 'FAMILY-2026', kind: 'parent', player_ids: [salma.id, mariam.id], max_uses: 5 }, admin.token));
    expect(invite.status).toBe(201);
    // A parent invitation names children without claiming them, so it keeps the
    // several uses it was given rather than being cut down to one.
    expect(await invite.json()).toMatchObject({ kind: 'parent', max_uses: 5 });

    const registered = await request('/api/v1/auth/register', json('POST', { name: 'Hala Nabil', email: 'hala@aimz.test', password: 'long-secure-password', invite_code: 'FAMILY-2026' }));
    expect(registered.status).toBe(201);
    const session = await registered.json<{ access_token: string; user: { role: string; player_id: string | null } }>();
    // A parent speaks for children rather than being one, so no roster record is
    // theirs — the link lives in user_children instead.
    expect(session.user).toMatchObject({ role: 'parent', player_id: null });

    const children = await (await request('/api/v1/users/me/children', json('GET', undefined, session.access_token))).json<{ items: { id: string; name: string; team_name: string }[] }>();
    expect(children.items.map((child) => child.name)).toEqual(['Mariam Adel', 'Salma Nabil']);
    expect(children.items.map((child) => child.team_name)).toEqual(['AIMZ U13', 'AIMZ U9']);

    // Two guardians of one child are expected, so a parent invitation does not
    // lock the roster record the way a player invitation does.
    const second = await request('/api/v1/admin/registration-invites', json('POST', { label: 'Second guardian', code: 'FAMILY-2026-B', kind: 'parent', player_ids: [salma.id] }, admin.token));
    expect(second.status).toBe(201);
    const father = await request('/api/v1/auth/register', json('POST', { name: 'Omar Nabil', email: 'omar@aimz.test', password: 'long-secure-password', invite_code: 'FAMILY-2026-B' }));
    expect(father.status).toBe(201);
    const his = await (await request('/api/v1/users/me/children', json('GET', undefined, (await father.json<{ access_token: string }>()).access_token))).json<{ items: { name: string }[] }>();
    expect(his.items.map((child) => child.name)).toEqual(['Salma Nabil']);

    // The accounts list joins on users.player_id, which is null for every
    // parent. Without the children beside it an administrator reads a linked
    // family as unlinked, and "fixes" it by writing a field parents never read.
    const accounts = await (await request('/api/v1/admin/users?limit=100', json('GET', undefined, admin.token))).json<{ items: { id: string; name: string; player: unknown; children: { name: string; team_name: string }[] }[] }>();
    const hala = accounts.items.find((account) => account.name === 'Hala Nabil');
    expect(hala).toMatchObject({ player: null });
    expect(hala?.children.map((child) => child.name)).toEqual(['Mariam Adel', 'Salma Nabil']);
    expect(hala?.children.map((child) => child.team_name)).toEqual(['AIMZ U13', 'AIMZ U9']);
    // An administrator speaks for nobody, so the field is present and empty
    // rather than missing.
    expect(accounts.items.find((account) => account.id === admin.id)?.children).toEqual([]);
  });
});

// 0023 rebuilds users, and DROP TABLE fires the foreign key actions pointing at
// it. Everything below would be lost to that — the parent links first among them
// — if the migration's copy-aside step were ever dropped. Run it a second time
// over live-looking rows to prove the step earns its place.
describe('the users rebuild keeps what points at it', () => {
  it('carries links, sessions and authorship through the migration', async () => {
    const admin = await seedUser('admin');
    const team = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U11', is_aimz: true }, admin.token))).json<{ id: string }>();
    const child = await (await request('/api/v1/players', json('POST', { name: 'Farida Sami', team_id: team.id, position: 'CM' }, admin.token))).json<{ id: string }>();
    const announcement = await (await request('/api/v1/announcements', json('POST', { team_id: team.id, title: 'Kit collection', body: 'Saturday', pinned: false }, admin.token))).json<{ id: string }>();
    const invite = await (await request('/api/v1/admin/registration-invites', json('POST', { label: 'Sami family', code: 'SAMI-2026', kind: 'parent', player_ids: [child.id] }, admin.token))).json<{ id: string }>();
    const parent = await (await request('/api/v1/auth/register', json('POST', { name: 'Sami Farid', email: 'sami@aimz.test', password: 'long-secure-password', invite_code: 'SAMI-2026' }))).json<{ user: { id: string } }>();
    // Registering issues a refresh session, which is the other CASCADE.
    const sessionsBefore = await testEnv.DB.prepare('SELECT COUNT(*) n FROM refresh_sessions WHERE user_id=?').bind(parent.user.id).first<{ n: number }>();
    expect(sessionsBefore?.n).toBe(1);

    const migrations = JSON.parse(testEnv.TEST_MIGRATIONS) as { name: string; queries: string[] }[];
    const rebuild = migrations.find((migration) => migration.name === '0023_parent_role.sql');
    expect(rebuild, 'the parent-role migration is in the chain').toBeTruthy();
    for (const query of rebuild!.queries) await testEnv.DB.prepare(query).run();

    const links = await testEnv.DB.prepare('SELECT player_id FROM user_children WHERE user_id=?').bind(parent.user.id).all<{ player_id: string }>();
    expect(links.results.map((row) => row.player_id)).toEqual([child.id]);
    const sessionsAfter = await testEnv.DB.prepare('SELECT COUNT(*) n FROM refresh_sessions WHERE user_id=?').bind(parent.user.id).first<{ n: number }>();
    expect(sessionsAfter?.n).toBe(1);
    expect((await testEnv.DB.prepare('SELECT author_id FROM announcements WHERE id=?').bind(announcement.id).first<{ author_id: string }>())?.author_id).toBe(admin.id);
    expect((await testEnv.DB.prepare('SELECT created_by_id FROM registration_invites WHERE id=?').bind(invite.id).first<{ created_by_id: string }>())?.created_by_id).toBe(admin.id);

    // And the point of the rebuild: the widened role still holds afterwards.
    const roles = await testEnv.DB.prepare('SELECT role FROM users WHERE id=?').bind(parent.user.id).first<{ role: string }>();
    expect(roles?.role).toBe('parent');
    const rejected = testEnv.DB.prepare('INSERT INTO users (id, name, email, password_hash, role, player_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)')
      .bind(crypto.randomUUID(), 'Nobody', 'nobody@aimz.test', 'unused', 'coach', now, now).run();
    await expect(rejected, 'the CHECK still refuses a role nobody defined').rejects.toThrow();
  });
});

// The feed is the one route with no bearer token: the secret is the URL. These
// cover what a calendar client actually depends on — that an edited fixture
// keeps its identity, and that the URL shows one family's fixtures and no more.
describe('parent calendar feed', () => {
  const uids = (ics: string) => ics.split('\r\n').filter((line) => line.startsWith('UID:')).map((line) => line.slice(4));
  const field = (ics: string, name: string) => ics.split('\r\n').filter((line) => line.startsWith(`${name}:`)).map((line) => line.slice(name.length + 1));

  // Storage is not reset between tests in this file, so every account and code
  // has to be its own — the same reason seedUser builds its email from a UUID.
  async function family() {
    const unique = crypto.randomUUID().slice(0, 8);
    const longVenue = 'ملعب أكاديمية إيمز الرئيسي في القاهرة الجديدة';
    const admin = await seedUser('admin');
    const squad = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U13', is_aimz: true }, admin.token))).json<{ id: string }>();
    const other = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U18', is_aimz: true }, admin.token))).json<{ id: string }>();
    const rivals = await (await request('/api/v1/teams', json('POST', { name: 'Al Ahly', is_aimz: false }, admin.token))).json<{ id: string }>();
    const child = await (await request('/api/v1/players', json('POST', { name: 'Farida Sami', team_id: squad.id, position: 'CM' }, admin.token))).json<{ id: string }>();
    const stranger = await (await request('/api/v1/players', json('POST', { name: 'Someone Else', team_id: other.id, position: 'GK' }, admin.token))).json<{ id: string }>();
    // Competitions are unique by name and season, and this integration file
    // intentionally keeps its D1 state between tests.
    const competition = await (await request('/api/v1/competitions', json('POST', { name: `Cairo League ${unique}`, season: '2026/27', type: 'league' }, admin.token))).json<{ id: string }>();
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const oursResponse = await request('/api/v1/matches', json('POST', { competition_id: competition.id, home_team_id: squad.id, away_team_id: rivals.id, kickoff_datetime: soon, venue: longVenue, status: 'scheduled' }, admin.token));
    expect(oursResponse.status, await oursResponse.clone().text()).toBe(201);
    const ours = await oursResponse.json<{ id: string }>();
    const theirsResponse = await request('/api/v1/matches', json('POST', { competition_id: competition.id, home_team_id: other.id, away_team_id: rivals.id, kickoff_datetime: soon, venue: 'Elsewhere', status: 'scheduled' }, admin.token));
    expect(theirsResponse.status, await theirsResponse.clone().text()).toBe(201);
    const theirs = await theirsResponse.json<{ id: string }>();
    await request('/api/v1/training-sessions', json('POST', { team_id: squad.id, venue: 'AIMZ Ground', notes: 'Bring shin pads', duration_minutes: 90, occurrences: [new Date(Date.now() + 86_400_000).toISOString()] }, admin.token));
    await request('/api/v1/admin/registration-invites', json('POST', { label: 'Sami family', code: `SAMI-CAL-${unique}`, kind: 'parent', player_ids: [child.id] }, admin.token));
    const parent = await (await request('/api/v1/auth/register', json('POST', { name: 'Sami Farid', email: `cal-${unique}@aimz.test`, password: 'long-secure-password', invite_code: `SAMI-CAL-${unique}` }))).json<{ access_token: string }>();
    // Asking for a feed is a POST now: reading one no longer conjures it.
    const feed = await (await request('/api/v1/users/me/calendar', json('POST', {}, parent.access_token))).json<{ url: string; subscribed_at: string | null }>();
    return { admin, parent, feed, ours, theirs, stranger, competition, rivals, other, soon, longVenue };
  }

  /**
   * A parent with a child but no calendar feed, which is the starting state
   * every account now has until it asks for one.
   */
  async function freshParent(): Promise<{ id: string; token: string }> {
    const unique = crypto.randomUUID().slice(0, 8);
    const admin = await seedUser('admin');
    const squad = await (await request('/api/v1/teams', json('POST', { name: `AIMZ U15 ${unique}`, is_aimz: true }, admin.token))).json<{ id: string }>();
    const child = await (await request('/api/v1/players', json('POST', { name: `Child ${unique}`, team_id: squad.id, position: 'CM' }, admin.token))).json<{ id: string }>();
    await request('/api/v1/admin/registration-invites', json('POST', { label: `Family ${unique}`, code: `FRESH-${unique}`, kind: 'parent', player_ids: [child.id] }, admin.token));
    const registered = await (await request('/api/v1/auth/register', json('POST', { name: `Parent ${unique}`, email: `fresh-${unique}@aimz.test`, password: 'long-secure-password', invite_code: `FRESH-${unique}` }))).json<{ access_token: string }>();
    const me = await (await request('/api/v1/users/me', json('GET', undefined, registered.access_token))).json<{ id: string }>();
    return { id: me.id, token: registered.access_token };
  }

  /** The feed is fetched the way a calendar client would: no Authorization header. */
  const fetchFeed = (url: string) => request(new URL(url).pathname);

  it('serves one family fixtures, and nobody else’s', async () => {
    const { feed, ours, theirs, longVenue } = await family();
    expect(feed.url).toMatch(/\/api\/v1\/calendar\/[\w-]{20,}\/aimz\.ics$/u);
    expect(feed.subscribed_at).toBeNull();

    const response = await fetchFeed(feed.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    const ics = await response.text();

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    // Every line ends CRLF, which clients are stricter about than they look.
    expect(ics.split('\r\n').join('')).not.toContain('\n');
    expect(uids(ics)).toEqual([`match-${ours.id}@aimz-egypt`, 'training-'.concat(uids(ics)[1]!.slice(9))]);
    expect(uids(ics)).not.toContain(`match-${theirs.id}@aimz-egypt`);
    expect(ics).toContain('SUMMARY:AIMZ U13 vs Al Ahly');
    expect(ics).toContain('SUMMARY:AIMZ U13 training');
    expect(ics).toContain('LOCATION:AIMZ Ground');
    expect(ics).toContain('X-WR-CALNAME:AIMZ · Farida Sami');
    // Folding is by UTF-8 octet, not JavaScript character: Arabic reaches the
    // limit well before 75 visible letters. Unfolding recovers the full value.
    expect(ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(ics.replace(/\r\n /gu, '')).toContain(`LOCATION:${longVenue}`);
  });

  // The whole point of a stable UID: a moved kick-off must edit the entry
  // already in the parent's calendar, not add a second one beside it.
  it('keeps a fixture’s identity when it moves, and drops it when deleted', async () => {
    const { admin, feed, ours } = await family();
    const before = await (await fetchFeed(feed.url)).text();
    const wasSequence = Number(field(before, 'SEQUENCE')[0]);

    const moved = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect((await request(`/api/v1/matches/${ours.id}`, json('PATCH', { kickoff_datetime: moved, venue: 'New Ground' }, admin.token))).status).toBe(200);
    const after = await (await fetchFeed(feed.url)).text();

    expect(uids(after)).toContain(`match-${ours.id}@aimz-egypt`);
    expect(uids(after).filter((uid) => uid === `match-${ours.id}@aimz-egypt`)).toHaveLength(1);
    expect(after).toContain('LOCATION:New Ground');
    expect(Number(field(after, 'SEQUENCE')[0])).toBeGreaterThanOrEqual(wasSequence);

    // No cancellation flag exists in the API, so a deleted fixture simply stops
    // being published and the client reconciles it away.
    expect((await request(`/api/v1/matches/${ours.id}`, json('DELETE', undefined, admin.token))).status).toBe(204);
    expect(uids(await (await fetchFeed(feed.url)).text())).not.toContain(`match-${ours.id}@aimz-egypt`);
  });

  it('records the first fetch once, and regenerating revokes the old address', async () => {
    const { parent, feed } = await family();
    await fetchFeed(feed.url);
    const seen = await (await request('/api/v1/users/me/calendar', json('GET', undefined, parent.access_token))).json<{ url: string; subscribed_at: string | null }>();
    expect(seen.subscribed_at).not.toBeNull();
    // The same URL comes back, so a parent can add it on a second device.
    expect(seen.url).toBe(feed.url);

    await fetchFeed(feed.url);
    const again = await (await request('/api/v1/users/me/calendar', json('GET', undefined, parent.access_token))).json<{ subscribed_at: string }>();
    expect(again.subscribed_at).toBe(seen.subscribed_at);

    const fresh = await (await request('/api/v1/users/me/calendar/regenerate', json('POST', {}, parent.access_token))).json<{ url: string; subscribed_at: string | null }>();
    expect(fresh.url).not.toBe(feed.url);
    expect(fresh.subscribed_at).toBeNull();
    expect((await fetchFeed(feed.url)).status).toBe(404);
    expect((await fetchFeed(fresh.url)).status).toBe(200);
  });

  it('gives nothing away for an address that was never real', async () => {
    await family();
    const response = await fetchFeed('http://aimz.test/api/v1/calendar/not-a-real-token-at-all/aimz.ics');
    expect(response.status).toBe(404);
    // An admin has no roster of their own, so there are no fixtures to follow.
    const admin = await seedUser('admin');
    expect((await request('/api/v1/users/me/calendar', json('GET', undefined, admin.token))).status).toBe(403);
  });

  /**
   * The one that makes removing mean anything. Reading used to mint a token,
   * so a deleted row came straight back and the subscription could never
   * actually be taken away.
   */
  it('does not conjure a feed just because someone looked', async () => {
    const { parent } = await family();
    const fresh = await freshParent();

    const before = await (await request('/api/v1/users/me/calendar', json('GET', undefined, fresh.token))).json<{ url: string | null; subscribed_at: string | null }>();
    expect(before).toEqual({ url: null, subscribed_at: null });
    // Not merely absent from the response — absent from the table.
    const rows = await testEnv.DB.prepare('SELECT COUNT(*) total FROM calendar_tokens WHERE user_id = ?').bind(fresh.id).first<{ total: number }>();
    expect(rows?.total).toBe(0);

    // The family that did ask still has theirs.
    const theirs = await (await request('/api/v1/users/me/calendar', json('GET', undefined, parent.access_token))).json<{ url: string | null }>();
    expect(theirs.url).toMatch(/\/aimz\.ics$/u);
  });

  it('hands back the same address when asked for one twice', async () => {
    const fresh = await freshParent();
    const first = await request('/api/v1/users/me/calendar', json('POST', {}, fresh.token));
    expect(first.status).toBe(201);
    const created = await first.json<{ url: string }>();

    const second = await request('/api/v1/users/me/calendar', json('POST', {}, fresh.token));
    // Already there, so nothing was created and the address is unchanged: a
    // second press of the Hub button must not revoke a working subscription.
    expect(second.status).toBe(200);
    expect((await second.json<{ url: string }>()).url).toBe(created.url);
  });

  it('takes the feed away, and leaves the old address answering like a stranger', async () => {
    const fresh = await freshParent();
    const created = await (await request('/api/v1/users/me/calendar', json('POST', {}, fresh.token))).json<{ url: string }>();
    expect((await fetchFeed(created.url)).status).toBe(200);

    expect((await request('/api/v1/users/me/calendar', json('DELETE', undefined, fresh.token))).status).toBe(204);

    // Gone from the account, and gone for anything still polling it.
    expect(await (await request('/api/v1/users/me/calendar', json('GET', undefined, fresh.token))).json()).toEqual({ url: null, subscribed_at: null });
    expect((await fetchFeed(created.url)).status).toBe(404);

    // Removing what is already gone is the state the caller asked for.
    expect((await request('/api/v1/users/me/calendar', json('DELETE', undefined, fresh.token))).status).toBe(204);

    // Setting up again is a different address, so removing is not undo.
    const again = await (await request('/api/v1/users/me/calendar', json('POST', {}, fresh.token))).json<{ url: string }>();
    expect(again.url).not.toBe(created.url);
    expect((await fetchFeed(again.url)).status).toBe(200);
  });

  it('refuses an admin on every one of them', async () => {
    const admin = await seedUser('admin');
    for (const init of [json('GET', undefined, admin.token), json('POST', {}, admin.token), json('DELETE', undefined, admin.token)]) {
      expect((await request('/api/v1/users/me/calendar', init)).status).toBe(403);
    }
    expect((await request('/api/v1/users/me/calendar/regenerate', json('POST', {}, admin.token))).status).toBe(403);
  });
});

describe('team badges and media', () => {
  it('holds badge_style apart from is_aimz and round-trips an uploaded crest', async () => {
    const admin = await seedUser('admin');

    // An unset badge_style leaves the badge to is_aimz, as it did before the column existed.
    const squad = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U14', is_aimz: true }, admin.token))).json<{ id: string; badge_style: string | null; logo_url: string | null }>();
    expect(squad).toMatchObject({ badge_style: null, logo_url: null });

    // A league club can keep full squad features without wearing the club crest.
    const club = await (await request('/api/v1/teams', json('POST', { name: 'Wadi Degla', is_aimz: true, badge_style: 'generated' }, admin.token))).json<{ id: string; badge_style: string; is_aimz: boolean }>();
    expect(club).toMatchObject({ badge_style: 'generated', is_aimz: true });

    const patched = await request(`/api/v1/teams/${club.id}`, json('PATCH', { badge_style: 'aimz' }, admin.token));
    expect(await patched.json()).toMatchObject({ badge_style: 'aimz', is_aimz: true });
    const cleared = await request(`/api/v1/teams/${club.id}`, json('PATCH', { badge_style: null }, admin.token));
    expect(await cleared.json()).toMatchObject({ badge_style: null });
    const rejected = await request(`/api/v1/teams/${club.id}`, json('PATCH', { badge_style: 'sparkles' }, admin.token));
    expect(rejected.status).toBe(422);

    const presigned = await request('/api/v1/media/uploads/presign', json('POST', { entity: 'team', entity_id: club.id, content_type: 'image/png' }, admin.token));
    expect(presigned.status).toBe(200);
    const upload = await presigned.json<{ upload_url: string; fields: Record<string, string>; object_key: string }>();
    expect(upload.object_key.startsWith(`teams/${club.id}/`)).toBe(true);
    expect(upload.object_key.endsWith('.png')).toBe(true);

    const crest = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const form = new FormData();
    for (const [field, value] of Object.entries(upload.fields)) form.append(field, value);
    form.append('file', new File([crest], 'crest.png', { type: 'image/png' }));
    const stored = await request('/api/v1/media/uploads', { method: 'POST', body: form });
    expect(stored.status).toBe(204);

    // Only once logo_key is set does the team report a URL to fetch it from.
    const withCrest = await request(`/api/v1/teams/${club.id}`, json('PATCH', { logo_key: upload.object_key }, admin.token));
    expect(await withCrest.json()).toMatchObject({ logo_url: `/api/v1/media/${upload.object_key}` });

    const fetched = await request(`/api/v1/media/${upload.object_key}`);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(crest);

    // The signed token is the whole authorisation, so a forged one stores nothing.
    const forged = new FormData();
    forged.append('token', 'not.asignedtoken');
    forged.append('file', new File([crest], 'crest.png', { type: 'image/png' }));
    const refused = await request('/api/v1/media/uploads', { method: 'POST', body: forged });
    expect(refused.status).toBe(403);
    expect((await request('/api/v1/media/teams/missing/nothing.png')).status).toBe(404);

    // A match carries each side's badge choice through the joined read.
    const competition = await (await request('/api/v1/competitions', json('POST', { name: 'WEPL', season: '2026/27', type: 'league' }, admin.token))).json<{ id: string }>();
    const fixture = await (await request('/api/v1/matches', json('POST', { competition_id: competition.id, home_team_id: squad.id, away_team_id: club.id, kickoff_datetime: now, venue: 'Cairo', status: 'scheduled' }, admin.token))).json<{ id: string }>();
    const read = await (await request(`/api/v1/matches/${fixture.id}/live`, json('GET', undefined, admin.token))).json<{ match: { away_team: { badge_style: string | null; logo_url: string | null } } }>();
    expect(read.match.away_team).toMatchObject({ badge_style: null, logo_url: `/api/v1/media/${upload.object_key}` });
  });
});

describe('statistics stay with the squad they were earned for', () => {
  it("keeps a promoted player's record under her old age group, and bulk-imports a squad", async () => {
    const admin = await seedUser('admin');
    const under14 = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U14', is_aimz: true, age_group: 'U14' }, admin.token))).json<{ id: string }>();
    const under16 = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U16', is_aimz: true, age_group: 'U16' }, admin.token))).json<{ id: string }>();
    const opponent = await (await request('/api/v1/teams', json('POST', { name: 'Cairo Stars', is_aimz: false }, admin.token))).json<{ id: string }>();
    const competition = await (await request('/api/v1/competitions', json('POST', { name: 'Youth League', season: '2026/27', type: 'league' }, admin.token))).json<{ id: string }>();

    // A whole squad in one request, which is the point of the bulk route.
    const bulk = await request('/api/v1/players/bulk', json('POST', {
      team_id: under14.id,
      players: [
        { name: 'Nour Hassan', position: 'ST', jersey_number: 9 },
        { name: 'Salma Adel', position: 'GK', jersey_number: 1 },
        { name: 'Habiba Tarek', position: 'LWB', jersey_number: 3 },
      ],
    }, admin.token));
    expect(bulk.status).toBe(201);
    const squadPlayers = await bulk.json<{ id: string; name: string; position: string }[]>();
    expect(squadPlayers).toHaveLength(3);
    const scorer = squadPlayers.find((player) => player.name === 'Nour Hassan')!;

    // A clash anywhere in the batch writes none of it.
    const clashing = await request('/api/v1/players/bulk', json('POST', {
      team_id: under14.id,
      players: [{ name: 'Farida Sami', position: 'CM', jersey_number: 8 }, { name: 'Malak Omar', position: 'CB', jersey_number: 9 }],
    }, admin.token));
    expect(clashing.status).toBe(409);
    const afterClash = await (await request(`/api/v1/players?team_id=${under14.id}`, json('GET', undefined, admin.token))).json<{ total: number }>();
    expect(afterClash.total).toBe(3);

    // Free text is no longer a position.
    const prose = await request('/api/v1/players', json('POST', { name: 'Yara Nabil', team_id: under14.id, position: 'Goalkeeper' }, admin.token));
    expect(prose.status).toBe(422);

    // She scores twice for the U14s.
    const match = await (await request('/api/v1/matches', json('POST', { competition_id: competition.id, home_team_id: under14.id, away_team_id: opponent.id, kickoff_datetime: now, venue: 'AIMZ Ground', status: 'scheduled' }, admin.token))).json<{ id: string }>();
    await request(`/api/v1/matches/${match.id}/lineup`, json('PUT', [{ player_id: scorer.id, team_id: under14.id, is_starter: true, position: 'ST' }], admin.token));
    await request(`/api/v1/matches/${match.id}/phase`, json('POST', { action: 'start_match' }, admin.token));
    for (const minute of [12, 40]) {
      const goal = await request(`/api/v1/matches/${match.id}/events`, json('POST', { type: 'goal', minute, team_id: under14.id, player_id: scorer.id, client_operation_id: `u14-goal-${minute}` }, admin.token));
      expect(goal.status).toBe(201);
    }
    await request(`/api/v1/matches/${match.id}/player-stats`, json('PUT', [{ player_id: scorer.id, appeared: true, minutes_played: 90 }], admin.token));
    for (const action of ['halftime', 'start_second_half', 'finish_match']) {
      await request(`/api/v1/matches/${match.id}/phase`, json('POST', { action }, admin.token));
    }

    const asU14 = await (await request('/api/v1/stats/leaders?metric=goals&age_group=U14', json('GET', undefined, admin.token))).json<{ player: { id: string }; goals: number; team: { id: string } }[]>();
    expect(asU14).toMatchObject([{ player: { id: scorer.id }, goals: 2, team: { id: under14.id } }]);

    // She is promoted to the U16s in September.
    expect((await request(`/api/v1/players/${scorer.id}`, json('PATCH', { team_id: under16.id }, admin.token))).status).toBe(200);

    // Her U14 goals stay U14 goals, and do not follow her up an age group.
    const stillU14 = await (await request('/api/v1/stats/leaders?metric=goals&age_group=U14', json('GET', undefined, admin.token))).json<{ player: { id: string }; goals: number; team: { id: string } }[]>();
    expect(stillU14).toMatchObject([{ player: { id: scorer.id }, goals: 2, team: { id: under14.id } }]);
    expect(await (await request('/api/v1/stats/leaders?metric=goals&age_group=U16', json('GET', undefined, admin.token))).json()).toEqual([]);

    // The profile names the opponent for a match played with a squad she has
    // left, and reports what she has reached along the way.
    const profile = await (await request(`/api/v1/players/${scorer.id}/stats`, json('GET', undefined, admin.token))).json<{
      goals: number;
      seasons: string[];
      milestones: { reached: { id: string }[] };
      matches: { opponent: { id: string }; team: { id: string } }[];
    }>();
    expect(profile.goals).toBe(2);
    expect(profile.seasons).toEqual(['2026/27']);
    expect(profile.matches[0]?.opponent.id).toBe(opponent.id);
    expect(profile.matches[0]?.team.id).toBe(under14.id);
    expect(profile.milestones.reached.map((item) => item.id)).toEqual(expect.arrayContaining(['first-goal', 'first-appearance']));

    // And her honours name the squad she won them with, marked final because
    // every match in the competition has been played.
    const honours = await (await request(`/api/v1/players/${scorer.id}/honours`, json('GET', undefined, admin.token))).json<{
      honours: { metric: string; is_final: boolean; team: { id: string } }[];
    }>();
    expect(honours.honours.find((item) => item.metric === 'goals')).toMatchObject({ is_final: true, team: { id: under14.id } });
  });
});

describe('man of the match eligibility', () => {
  it('lets a starter who did nothing notable take the award', async () => {
    const admin = await seedUser('admin');
    const squad = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U14', is_aimz: true, age_group: 'U14' }, admin.token))).json<{ id: string }>();
    const opponent = await (await request('/api/v1/teams', json('POST', { name: 'Cairo Stars', is_aimz: false }, admin.token))).json<{ id: string }>();
    const competition = await (await request('/api/v1/competitions', json('POST', { name: 'Award League', season: '2026/27', type: 'league' }, admin.token))).json<{ id: string }>();
    const squadPlayers = await (await request('/api/v1/players/bulk', json('POST', {
      team_id: squad.id,
      players: [
        { name: 'Nour Hassan', position: 'ST', jersey_number: 9 },
        { name: 'Salma Adel', position: 'CB', jersey_number: 4 },
        { name: 'Habiba Tarek', position: 'CM', jersey_number: 8 },
        { name: 'Malak Omar', position: 'RW', jersey_number: 11 },
      ],
    }, admin.token))).json<{ id: string; name: string }[]>();
    const scorer = squadPlayers.find((player) => player.name === 'Nour Hassan')!;
    // The defender who played the whole match and never troubled the timeline.
    const quiet = squadPlayers.find((player) => player.name === 'Salma Adel')!;
    const bench = squadPlayers.find((player) => player.name === 'Habiba Tarek')!;
    const unused = squadPlayers.find((player) => player.name === 'Malak Omar')!;

    const match = await (await request('/api/v1/matches', json('POST', { competition_id: competition.id, home_team_id: squad.id, away_team_id: opponent.id, kickoff_datetime: now, venue: 'AIMZ Ground', status: 'scheduled' }, admin.token))).json<{ id: string }>();
    await request(`/api/v1/matches/${match.id}/lineup`, json('PUT', [
      { player_id: scorer.id, team_id: squad.id, is_starter: true, position: 'ST' },
      { player_id: quiet.id, team_id: squad.id, is_starter: true, position: 'CB' },
      { player_id: bench.id, team_id: squad.id, is_starter: false, position: 'CM' },
      { player_id: unused.id, team_id: squad.id, is_starter: false, position: 'RW' },
    ], admin.token));

    await request(`/api/v1/matches/${match.id}/phase`, json('POST', { action: 'start_match' }, admin.token));
    await request(`/api/v1/matches/${match.id}/events`, json('POST', { type: 'goal', minute: 20, team_id: squad.id, player_id: scorer.id, client_operation_id: 'motm-goal-20' }, admin.token));
    // A substitution brings the bench player on; nothing else is ever logged for her.
    await request(`/api/v1/matches/${match.id}/events`, json('POST', { type: 'substitution', minute: 60, team_id: squad.id, player_id: bench.id, secondary_player_id: scorer.id, client_operation_id: 'motm-sub-60' }, admin.token));
    for (const action of ['halftime', 'start_second_half', 'finish_match']) {
      await request(`/api/v1/matches/${match.id}/phase`, json('POST', { action }, admin.token));
    }

    // Nobody typed in a minute and nothing in the timeline ever names her, but
    // she started, so the appearance is recorded from the team sheet.
    const stats = await (await request(`/api/v1/matches/${match.id}/player-stats`, json('GET', undefined, admin.token))).json<{ player_id: string; appeared: boolean; goals: number }[]>();
    expect(stats.find((stat) => stat.player_id === quiet.id)).toMatchObject({ appeared: true, goals: 0 });
    // And the substitute who came on, while the one who never did has none.
    expect(stats.find((stat) => stat.player_id === bench.id)).toMatchObject({ appeared: true });
    expect(stats.find((stat) => stat.player_id === unused.id)?.appeared ?? false).toBe(false);

    // She still played the whole match, so the award is hers to take.
    const award = await request(`/api/v1/matches/${match.id}/man-of-the-match`, json('POST', { player_id: quiet.id }, admin.token));
    expect(award.status).toBe(200);
    expect(await award.json()).toMatchObject({ man_of_the_match_player_id: quiet.id });

    // So is a substitute who came on and did nothing after that.
    expect((await request(`/api/v1/matches/${match.id}/man-of-the-match`, json('POST', { player_id: bench.id }, admin.token))).status).toBe(200);

    // The named substitute who never came on did not play, and is still refused.
    const refused = await request(`/api/v1/matches/${match.id}/man-of-the-match`, json('POST', { player_id: unused.id }, admin.token));
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ detail: { code: 'player_did_not_appear' } });

    // And the scorer, who qualified before this fix, still does.
    expect((await request(`/api/v1/matches/${match.id}/man-of-the-match`, json('POST', { player_id: scorer.id }, admin.token))).status).toBe(200);

    // The same correction the award needed also fixes what she is worth in the
    // tables: a player who turns out and never scores used to total nil
    // appearances everywhere in the app.
    const profile = await (await request(`/api/v1/players/${quiet.id}/stats`, json('GET', undefined, admin.token))).json<{ appearances: number; goals: number }>();
    expect(profile).toMatchObject({ appearances: 1, goals: 0 });

    // And she is in the running for the award that counts them.
    const everPresent = await (await request(`/api/v1/competitions/${competition.id}/awards/appearances`, json('GET', undefined, admin.token))).json<{ player: { id: string }; value: number }[]>();
    expect(everPresent.find((row) => row.player.id === quiet.id)).toMatchObject({ value: 1 });
    // The substitute who never came on is in nobody's table.
    expect(everPresent.some((row) => row.player.id === unused.id)).toBe(false);
  });
});

describe('the appearance backfill', () => {
  /**
   * Rows exactly as they were before appearances were recorded from the team
   * sheet: a finished match with a lineup and a timeline, and player_match_stats
   * holding only the players who did something.
   */
  async function seedLegacyMatch() {
    const ids = { match: crypto.randomUUID(), competition: crypto.randomUUID(), squad: crypto.randomUUID(), opponent: crypto.randomUUID() };
    const player = (name: string, position: string) => ({ id: crypto.randomUUID(), name, position });
    const scorer = player('Legacy Scorer', 'ST');
    const quiet = player('Legacy Defender', 'CB');
    const camyOn = player('Legacy Substitute', 'CM');
    const unused = player('Legacy Bench', 'RW');

    await testEnv.DB.batch([
      testEnv.DB.prepare("INSERT INTO competitions (id, name, season, type, created_at, updated_at) VALUES (?, ?, '2025/26', 'league', ?, ?)").bind(ids.competition, `Legacy League ${ids.competition}`, now, now),
      testEnv.DB.prepare("INSERT INTO teams (id, name, age_group, is_aimz, is_active, created_at, updated_at) VALUES (?, 'Legacy U14', 'U14', 1, 1, ?, ?)").bind(ids.squad, now, now),
      testEnv.DB.prepare("INSERT INTO teams (id, name, is_aimz, is_active, created_at, updated_at) VALUES (?, 'Legacy Opponent', 0, 1, ?, ?)").bind(ids.opponent, now, now),
      testEnv.DB.prepare("INSERT INTO matches (id, competition_id, home_team_id, away_team_id, kickoff_datetime, venue, status, phase, home_score, away_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Ground', 'finished', 'finished', 1, 0, ?, ?)").bind(ids.match, ids.competition, ids.squad, ids.opponent, now, now, now),
    ]);
    await testEnv.DB.batch([scorer, quiet, camyOn, unused].map((p) =>
      testEnv.DB.prepare("INSERT INTO players (id, name, team_id, position, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)").bind(p.id, p.name, ids.squad, p.position, now, now)));
    await testEnv.DB.batch([
      ...[[scorer, 1], [quiet, 1], [camyOn, 0], [unused, 0]].map(([p, starter]) =>
        testEnv.DB.prepare("INSERT INTO match_lineup_entries (id, match_id, player_id, team_id, is_starter, is_captain, position) VALUES (?, ?, ?, ?, ?, 0, ?)")
          .bind(crypto.randomUUID(), ids.match, (p as typeof scorer).id, ids.squad, starter, (p as typeof scorer).position)),
      testEnv.DB.prepare("INSERT INTO match_events (id, match_id, type, minute, team_id, player_id, is_penalty, client_operation_id, created_at, updated_at) VALUES (?, ?, 'goal', 20, ?, ?, 0, ?, ?, ?)")
        .bind(crypto.randomUUID(), ids.match, ids.squad, scorer.id, `legacy-goal-${ids.match}`, now, now),
      testEnv.DB.prepare("INSERT INTO match_events (id, match_id, type, minute, team_id, player_id, secondary_player_id, is_penalty, client_operation_id, created_at, updated_at) VALUES (?, ?, 'substitution', 60, ?, ?, ?, 0, ?, ?, ?)")
        .bind(crypto.randomUUID(), ids.match, ids.squad, camyOn.id, scorer.id, `legacy-sub-${ids.match}`, now, now),
      // Only the scorer has a statistic, which is exactly the state this fixes.
      testEnv.DB.prepare("INSERT INTO player_match_stats (id, match_id, player_id, team_id, appeared, minutes_played, goals, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 60, 1, ?, ?)")
        .bind(crypto.randomUUID(), ids.match, scorer.id, ids.squad, now, now),
    ]);
    return { ids, scorer, quiet, camyOn, unused };
  }

  /** Runs the backfill migration again, over the legacy rows just inserted. */
  async function runBackfill() {
    const migrations = JSON.parse(testEnv.TEST_MIGRATIONS) as { name: string; queries: string[] }[];
    const backfill = migrations.find((migration) => migration.name === '0022_backfill_appearances.sql');
    expect(backfill, 'the backfill migration is in the chain').toBeTruthy();
    for (const query of backfill!.queries) await testEnv.DB.prepare(query).run();
  }

  const appearances = async (matchId: string) => {
    const rows = await testEnv.DB.prepare('SELECT player_id, appeared, minutes_played, team_id, goals FROM player_match_stats WHERE match_id=?').bind(matchId).all<{ player_id: string; appeared: number; minutes_played: number; team_id: string | null; goals: number }>();
    return new Map(rows.results.map((row) => [row.player_id, row]));
  };

  it('records the appearance of everyone who played but did nothing notable', async () => {
    const { ids, scorer, quiet, camyOn, unused } = await seedLegacyMatch();

    // Before: only the scorer counts, which is the undercount being corrected.
    const before = await appearances(ids.match);
    expect(before.size).toBe(1);
    expect(before.has(quiet.id)).toBe(false);

    await runBackfill();

    const after = await appearances(ids.match);
    // The starter who never troubled the timeline.
    expect(after.get(quiet.id)).toMatchObject({ appeared: 1, team_id: ids.squad });
    // The substitute who came on.
    expect(after.get(camyOn.id)).toMatchObject({ appeared: 1, team_id: ids.squad });
    // The one who stayed on the bench did not play, and is not invented.
    expect(after.has(unused.id)).toBe(false);
    // The scorer's own record is untouched — not reset, not doubled.
    expect(after.get(scorer.id)).toMatchObject({ appeared: 1, minutes_played: 60, goals: 1 });
  });

  it('invents no minutes for an appearance nobody typed a number into', async () => {
    const { ids, quiet } = await seedLegacyMatch();
    await runBackfill();
    expect((await appearances(ids.match)).get(quiet.id)?.minutes_played).toBe(0);
  });

  it('can be run twice without doubling anything or colliding on an id', async () => {
    const { ids } = await seedLegacyMatch();
    await runBackfill();
    const once = await appearances(ids.match);
    await runBackfill();
    const twice = await appearances(ids.match);
    expect(twice.size).toBe(once.size);
    expect([...twice.values()].every((row) => row.appeared === 1)).toBe(true);
  });

  it('leaves a match that never kicked off out of it', async () => {
    const { ids, quiet } = await seedLegacyMatch();
    await testEnv.DB.prepare("UPDATE matches SET status='scheduled', phase='not_started' WHERE id=?").bind(ids.match).run();
    await runBackfill();
    expect((await appearances(ids.match)).has(quiet.id)).toBe(false);
  });
});

describe('accounts that expire', () => {
  const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
  const password = 'a-long-enough-password';
  const signIn = (email: string) => request('/api/v1/auth/login', json('POST', { email, password }));

  const makeAccount = async (token: string, over: Record<string, unknown> = {}) => {
    const response = await request('/api/v1/admin/users', json('POST', {
      name: 'Weekend Guest', email: `guest-${crypto.randomUUID()}@aimz.test`, password, role: 'admin', ...over,
    }, token));
    return { response, body: await response.json<Record<string, unknown>>() };
  };

  it('opens an account that lasts 48 hours, in any of the three roles', async () => {
    const admin = await seedUser('admin');
    for (const role of ['admin', 'player', 'parent'] as const) {
      const { response, body } = await makeAccount(admin.token, { role, expires_at: hoursFromNow(48) });
      expect(response.status).toBe(201);
      expect(body).toMatchObject({ role });
      expect(Date.parse(body.expires_at as string)).toBeGreaterThan(Date.now());
      expect((await signIn(body.email as string)).status).toBe(200);
    }
  });

  it('turns the account away once its date has gone', async () => {
    const admin = await seedUser('admin');
    const { body } = await makeAccount(admin.token, { expires_at: hoursFromNow(48) });
    await testEnv.DB.prepare('UPDATE account_expiry SET expires_at = ? WHERE user_id = ?').bind(hoursFromNow(-1), body.id).run();
    const late = await signIn(body.email as string);
    expect(late.status).toBe(401);
    expect(await late.json()).toMatchObject({ detail: { code: 'account_expired' } });
  });

  // A token already in hand outlives the deadline by its own lifetime, and a
  // refresh token by a month, so the date is checked on every request too.
  it('turns away a token minted before the date passed', async () => {
    const admin = await seedUser('admin');
    const { body } = await makeAccount(admin.token, { role: 'player', expires_at: hoursFromNow(48) });
    const token = await createAccessToken(body.id as string, 'player', testEnv.JWT_SECRET, 900);
    expect((await request('/api/v1/users/me', json('GET', undefined, token))).status).toBe(200);

    await testEnv.DB.prepare('UPDATE account_expiry SET expires_at = ? WHERE user_id = ?').bind(hoursFromNow(-1), body.id).run();
    const after = await request('/api/v1/users/me', json('GET', undefined, token));
    expect(after.status).toBe(401);
    expect(await after.json()).toMatchObject({ detail: { code: 'account_expired' } });
  });

  it('lets an administrator lift the date or set a new one', async () => {
    const admin = await seedUser('admin');
    const { body } = await makeAccount(admin.token, { role: 'parent', expires_at: hoursFromNow(48) });

    const lifted = await request(`/api/v1/admin/users/${body.id}`, json('PATCH', { expires_at: null }, admin.token));
    expect(await lifted.json()).toMatchObject({ expires_at: null });
    expect((await signIn(body.email as string)).status).toBe(200);

    const renewed = await request(`/api/v1/admin/users/${body.id}`, json('PATCH', { expires_at: hoursFromNow(72) }, admin.token));
    expect((await renewed.json()).expires_at).not.toBeNull();
    const stored = await testEnv.DB.prepare('SELECT COUNT(*) n FROM account_expiry WHERE user_id = ?').bind(body.id).first<{ n: number }>();
    expect(stored?.n).toBe(1);
  });

  it('refuses a date that has already gone', async () => {
    const admin = await seedUser('admin');
    const { response } = await makeAccount(admin.token, { expires_at: hoursFromNow(-1) });
    expect(response.status).toBe(422);
  });

  it('leaves an account asked for without a date working, and unrecorded', async () => {
    const admin = await seedUser('admin');
    const { body } = await makeAccount(admin.token);
    expect(body.expires_at).toBeNull();
    const rows = await testEnv.DB.prepare('SELECT COUNT(*) n FROM account_expiry WHERE user_id = ?').bind(body.id).first<{ n: number }>();
    expect(rows?.n).toBe(0);
    expect((await signIn(body.email as string)).status).toBe(200);
  });

  it('takes the date away with the account', async () => {
    const admin = await seedUser('admin');
    const { body } = await makeAccount(admin.token, { expires_at: hoursFromNow(48) });
    await testEnv.DB.prepare('DELETE FROM users WHERE id = ?').bind(body.id).run();
    const rows = await testEnv.DB.prepare('SELECT COUNT(*) n FROM account_expiry WHERE user_id = ?').bind(body.id).first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
});

describe('training attendance', () => {
  const setUp = async () => {
    const admin = await seedUser('admin');
    const team = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U15', is_aimz: true }, admin.token))).json<{ id: string }>();
    const squad: { id: string }[] = [];
    for (const name of ['Amina', 'Nour', 'Salma']) {
      squad.push(await (await request('/api/v1/players', json('POST', { name, team_id: team.id, position: 'CM' }, admin.token))).json<{ id: string }>());
    }
    const sessions = await (await request('/api/v1/training-sessions', json('POST', {
      team_id: team.id, venue: 'Palm', notes: null, duration_minutes: 90,
      occurrences: ['2026-09-01T15:00:00.000Z', '2026-09-03T15:00:00.000Z'],
    }, admin.token))).json<{ id: string }[]>();
    return { admin, team, squad, sessions };
  };

  const register = (id: string, token: string) => request(`/api/v1/training-sessions/${id}/attendance`, json('GET', undefined, token));
  const mark = (id: string, token: string, entries: unknown[]) =>
    request(`/api/v1/training-sessions/${id}/attendance`, json('PUT', { entries }, token));

  it('hands back the whole squad to mark before anyone has been marked', async () => {
    const { admin, squad, sessions } = await setUp();
    const body = await (await register(sessions[0]!.id, admin.token)).json<{ items: { status: string | null }[]; present: number; unmarked: number }>();
    expect(body.items).toHaveLength(squad.length);
    expect(body.items.every((row) => row.status === null)).toBe(true);
    expect(body.unmarked).toBe(squad.length);
    expect(body.present).toBe(0);
  });

  it('marks players and answers with the tallies', async () => {
    const { admin, squad, sessions } = await setUp();
    const response = await mark(sessions[0]!.id, admin.token, [
      { player_id: squad[0]!.id, status: 'present' },
      { player_id: squad[1]!.id, status: 'present' },
      { player_id: squad[2]!.id, status: 'absent' },
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ present: 2, absent: 1, unmarked: 0 });
  });

  // The whole point of "editable after saving".
  it('changes one mark without disturbing the rest', async () => {
    const { admin, squad, sessions } = await setUp();
    await mark(sessions[0]!.id, admin.token, squad.map((player) => ({ player_id: player.id, status: 'present' })));
    const after = await (await mark(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, status: 'absent' }])).json<{ present: number; absent: number }>();
    expect(after).toMatchObject({ present: 2, absent: 1 });
  });

  it('takes a mark away again when it is sent as null', async () => {
    const { admin, squad, sessions } = await setUp();
    await mark(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, status: 'present' }]);
    const after = await (await mark(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, status: null }])).json<{ present: number; unmarked: number }>();
    expect(after).toMatchObject({ present: 0, unmarked: 3 });
  });

  it('refuses a player who is not on this squad', async () => {
    const { admin, sessions } = await setUp();
    const other = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U17', is_aimz: true }, admin.token))).json<{ id: string }>();
    const outsider = await (await request('/api/v1/players', json('POST', { name: 'Stranger', team_id: other.id, position: 'ST' }, admin.token))).json<{ id: string }>();
    const response = await mark(sessions[0]!.id, admin.token, [{ player_id: outsider.id, status: 'present' }]);
    expect(response.status).toBe(422);
  });

  it('lets nobody but an administrator take the register', async () => {
    const { admin, squad, sessions } = await setUp();
    const playerUser = await seedUser('player', squad[0]!.id);
    const response = await mark(sessions[0]!.id, playerUser.token, [{ player_id: squad[0]!.id, status: 'present' }]);
    expect(response.status).toBe(403);
    // Reading it is fine: a player can see who was at their own session.
    expect((await register(sessions[0]!.id, playerUser.token)).status).toBe(200);
  });

  it('goes away with the session it belongs to', async () => {
    const { admin, squad, sessions } = await setUp();
    await mark(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, status: 'present' }]);
    await request(`/api/v1/training-sessions/${sessions[0]!.id}`, json('DELETE', undefined, admin.token));
    const left = await testEnv.DB.prepare('SELECT COUNT(*) n FROM training_attendance WHERE training_session_id = ?').bind(sessions[0]!.id).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  describe('the percentage on a player', () => {
    const percentOf = async (playerId: string, token: string) =>
      (await (await request(`/api/v1/players/${playerId}/stats`, json('GET', undefined, token))).json<{ training_attendance_pct: number | null; trainings_attended: number; trainings_expected: number }>());

    it('has none at all until somebody has been marked', async () => {
      const { admin, squad } = await setUp();
      expect(await percentOf(squad[0]!.id, admin.token)).toMatchObject({ training_attendance_pct: null, trainings_attended: 0, trainings_expected: 0 });
    });

    it('counts attended over the sessions marked either way', async () => {
      const { admin, squad, sessions } = await setUp();
      await mark(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, status: 'present' }]);
      await mark(sessions[1]!.id, admin.token, [{ player_id: squad[0]!.id, status: 'absent' }]);
      expect(await percentOf(squad[0]!.id, admin.token)).toMatchObject({ training_attendance_pct: 50, trainings_attended: 1, trainings_expected: 2 });
    });

    // The requirement that it updates whenever attendance changes.
    it('follows the register when a mark is corrected', async () => {
      const { admin, squad, sessions } = await setUp();
      await mark(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, status: 'absent' }]);
      expect((await percentOf(squad[0]!.id, admin.token)).training_attendance_pct).toBe(0);
      await mark(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, status: 'present' }]);
      expect((await percentOf(squad[0]!.id, admin.token)).training_attendance_pct).toBe(100);
    });

    // A session nobody took a register for is nobody's fault.
    it('ignores a session where the player was never marked', async () => {
      const { admin, squad, sessions } = await setUp();
      await mark(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, status: 'present' }]);
      expect(await percentOf(squad[0]!.id, admin.token)).toMatchObject({ training_attendance_pct: 100, trainings_expected: 1 });
    });
  });
});

describe('the API is shut to strangers', () => {
  // The roster is the names of children. It was readable by anyone who knew the
  // address, because authorisation was written per route and the read routes
  // never received any.
  const closed = [
    ['GET', '/api/v1/players'],
    ['GET', '/api/v1/teams'],
    ['GET', '/api/v1/matches'],
    ['GET', '/api/v1/competitions'],
    ['GET', '/api/v1/stats/leaders'],
    ['GET', '/api/v1/announcements'],
    ['GET', '/api/v1/training-sessions'],
  ] as const;

  it.each(closed)('refuses %s %s without an account', async (method, path) => {
    const response = await request(path, json(method));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ detail: { code: 'authentication_required' } });
  });

  it('refuses a player profile and its statistics to a stranger', async () => {
    const admin = await seedUser('admin');
    const team = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U11', is_aimz: true }, admin.token))).json<{ id: string }>();
    const player = await (await request('/api/v1/players', json('POST', { name: 'Salma', team_id: team.id, position: 'CM' }, admin.token))).json<{ id: string }>();

    expect((await request(`/api/v1/players/${player.id}/stats`, json('GET'))).status).toBe(401);
    expect((await request(`/api/v1/players/${player.id}/honours`, json('GET'))).status).toBe(401);
    // A signed-in account still reads them: squad-mates see each other.
    expect((await request(`/api/v1/players/${player.id}/stats`, json('GET', undefined, admin.token))).status).toBe(200);
  });

  // The ways in have to answer a stranger, or nobody could ever sign in.
  it('still lets a stranger reach health and the sign-in routes', async () => {
    expect((await request('/api/v1/health', json('GET'))).status).toBe(200);
    expect((await request('/api/v1/health/ready', json('GET'))).status).toBe(200);
    // Wrong credentials, but reaching the handler at all is the point: a 401
    // from the gate would carry `authentication_required` instead.
    const login = await request('/api/v1/auth/login', json('POST', { email: 'nobody@aimz.test', password: 'wrong-password' }));
    expect(await login.json()).toMatchObject({ detail: { code: 'invalid_credentials' } });
  });

  it('turns away a token that is not a token', async () => {
    const response = await request('/api/v1/players', json('GET', undefined, 'not-a-real-token'));
    expect(response.status).toBe(401);
  });
});

describe('fees', () => {
  const setUp = async () => {
    const admin = await seedUser('admin');
    const team = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U16', is_aimz: true }, admin.token))).json<{ id: string }>();
    const squad: { id: string; name: string }[] = [];
    for (const name of ['Amina', 'Nour', 'Salma']) {
      squad.push(await (await request('/api/v1/players', json('POST', { name, team_id: team.id, position: 'CM' }, admin.token))).json<{ id: string; name: string }>());
    }
    const plan = await (await request('/api/v1/fee-plans', json('POST', {
      team_id: team.id, label: 'Monthly subscription', amount_piastres: 120000, due_day: 5,
    }, admin.token))).json<{ id: string }>();
    return { admin, team, squad, plan };
  };

  const generate = (planId: string, token: string, period = '2026-09') =>
    request(`/api/v1/fee-plans/${planId}/generate`, json('POST', { period }, token));

  const chargesFor = async (playerId: string, token: string) =>
    (await (await request(`/api/v1/fee-charges?player_id=${playerId}`, json('GET', undefined, token))).json<{ items: { id: string; amount_piastres: number; paid_piastres: number; outstanding_piastres: number; status: string }[] }>()).items;

  const pay = (chargeId: string, token: string, amount: number, over: Record<string, unknown> = {}) =>
    request(`/api/v1/fee-charges/${chargeId}/payments`, json('POST', { amount_piastres: amount, method: 'cash', ...over }, token));

  it('raises one charge per player for the month', async () => {
    const { admin, squad, plan } = await setUp();
    const response = await generate(plan.id, admin.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ period: '2026-09', created: 3, skipped: 0, squad_size: 3 });
    const charges = await chargesFor(squad[0]!.id, admin.token);
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ amount_piastres: 120000, paid_piastres: 0, outstanding_piastres: 120000 });
  });

  // The single most valuable test here: a button gets pressed twice.
  it('bills a month once however many times the button is pressed', async () => {
    const { admin, plan } = await setUp();
    await generate(plan.id, admin.token);
    const again = await (await generate(plan.id, admin.token)).json<{ created: number; skipped: number }>();
    expect(again).toMatchObject({ created: 0, skipped: 3 });
    const total = await testEnv.DB.prepare('SELECT COUNT(*) n FROM fee_charges WHERE fee_plan_id = ?').bind(plan.id).first<{ n: number }>();
    expect(total?.n).toBe(3);
  });

  it('picks up a player who joined after the month was billed', async () => {
    const { admin, team, plan } = await setUp();
    await generate(plan.id, admin.token);
    await request('/api/v1/players', json('POST', { name: 'Latecomer', team_id: team.id, position: 'ST' }, admin.token));
    expect(await (await generate(plan.id, admin.token)).json()).toMatchObject({ created: 1, skipped: 3 });
  });

  it('counts a part payment as partly paid, and the rest as settled', async () => {
    const { admin, squad, plan } = await setUp();
    // A month whose due day is still ahead, so "partial" is not "overdue".
    const ahead = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 7);
    await generate(plan.id, admin.token, ahead);
    const charge = (await chargesFor(squad[0]!.id, admin.token))[0]!;

    expect((await pay(charge.id, admin.token, 50000)).status).toBe(201);
    let after = (await chargesFor(squad[0]!.id, admin.token))[0]!;
    expect(after).toMatchObject({ paid_piastres: 50000, outstanding_piastres: 70000, status: 'partial' });

    await pay(charge.id, admin.token, 70000);
    after = (await chargesFor(squad[0]!.id, admin.token))[0]!;
    expect(after).toMatchObject({ paid_piastres: 120000, outstanding_piastres: 0, status: 'paid' });
  });

  it('refuses more money than is owed, and says how much is left', async () => {
    const { admin, squad, plan } = await setUp();
    await generate(plan.id, admin.token);
    const charge = (await chargesFor(squad[0]!.id, admin.token))[0]!;
    await pay(charge.id, admin.token, 100000);
    const tooMuch = await pay(charge.id, admin.token, 50000);
    expect(tooMuch.status).toBe(422);
    expect(await tooMuch.json()).toMatchObject({ detail: { field_errors: [{ field: 'amount_piastres', message: '20000 piastres are outstanding.' }] } });
  });

  it('keeps every instalment rather than a running total', async () => {
    const { admin, squad, plan } = await setUp();
    await generate(plan.id, admin.token);
    const charge = (await chargesFor(squad[0]!.id, admin.token))[0]!;
    await pay(charge.id, admin.token, 50000, { paid_on: '2026-09-03', method: 'instapay' });
    await pay(charge.id, admin.token, 30000, { paid_on: '2026-09-17', method: 'cash' });
    const full = await (await request(`/api/v1/fee-charges/${charge.id}`, json('GET', undefined, admin.token))).json<{ payments: { amount_piastres: number; recorded_by_name: string }[] }>();
    expect(full.payments).toHaveLength(2);
    expect(full.payments.map((row) => row.amount_piastres)).toEqual([50000, 30000]);
    expect(full.payments[0]?.recorded_by_name).toBe('Test Admin');
  });

  it('calls an unpaid charge overdue once its day has gone', async () => {
    const { admin, squad } = await setUp();
    const charge = await (await request('/api/v1/fee-charges', json('POST', {
      player_id: squad[0]!.id, label: 'Kit', amount_piastres: 40000, due_on: '2020-01-01',
    }, admin.token))).json<{ id: string; status: string }>();
    expect(charge.status).toBe('overdue');
  });

  it('cancels a charge rather than deleting it, and takes no more money for it', async () => {
    const { admin, squad } = await setUp();
    const charge = await (await request('/api/v1/fee-charges', json('POST', {
      player_id: squad[0]!.id, label: 'Tournament', amount_piastres: 30000, due_on: '2026-10-01',
    }, admin.token))).json<{ id: string }>();
    const voided = await (await request(`/api/v1/fee-charges/${charge.id}/void`, json('POST', { reason: 'Raised twice' }, admin.token))).json<{ status: string; void_reason: string }>();
    expect(voided).toMatchObject({ status: 'void', void_reason: 'Raised twice' });
    expect((await pay(charge.id, admin.token, 1000)).status).toBe(409);
    const still = await testEnv.DB.prepare('SELECT COUNT(*) n FROM fee_charges WHERE id = ?').bind(charge.id).first<{ n: number }>();
    expect(still?.n).toBe(1);
  });

  it('writes an audit entry for money taken', async () => {
    const { admin, squad, plan } = await setUp();
    await generate(plan.id, admin.token);
    const charge = (await chargesFor(squad[0]!.id, admin.token))[0]!;
    await pay(charge.id, admin.token, 25000);
    const audits = await testEnv.DB.prepare("SELECT action, summary FROM audit_log WHERE action = 'fee_payment_recorded' AND entity_id = ?").bind(charge.id).all<{ action: string; summary: string }>();
    expect(audits.results).toHaveLength(1);
    expect(audits.results[0]?.summary).toContain('25000 piastres');
  });

  describe('the squad ledger', () => {
    it('totals the squad and puts whoever owes most at the top', async () => {
      const { admin, team, squad, plan } = await setUp();
      await generate(plan.id, admin.token);
      // One settled, one half paid, one untouched.
      const first = (await chargesFor(squad[0]!.id, admin.token))[0]!;
      const second = (await chargesFor(squad[1]!.id, admin.token))[0]!;
      await pay(first.id, admin.token, 120000);
      await pay(second.id, admin.token, 60000);

      const summary = await (await request(`/api/v1/teams/${team.id}/fee-summary?period=2026-09`, json('GET', undefined, admin.token))).json<{
        totals: { charged_piastres: number; paid_piastres: number; outstanding_piastres: number; players_paid: number; players_outstanding: number };
        players: { player: { id: string }; outstanding_piastres: number; status: string }[];
      }>();
      expect(summary.totals).toMatchObject({ charged_piastres: 360000, paid_piastres: 180000, outstanding_piastres: 180000, players_paid: 1, players_outstanding: 2 });
      expect(summary.players[0]?.outstanding_piastres).toBe(120000);
      expect(summary.players.at(-1)).toMatchObject({ status: 'paid', outstanding_piastres: 0 });
    });

    it('leaves a cancelled charge out of the totals', async () => {
      const { admin, team, squad } = await setUp();
      const charge = await (await request('/api/v1/fee-charges', json('POST', {
        player_id: squad[0]!.id, label: 'Kit', amount_piastres: 40000, due_on: '2026-10-01',
      }, admin.token))).json<{ id: string }>();
      await request(`/api/v1/fee-charges/${charge.id}/void`, json('POST', {}, admin.token));
      const summary = await (await request(`/api/v1/teams/${team.id}/fee-summary`, json('GET', undefined, admin.token))).json<{ totals: { charged_piastres: number } }>();
      expect(summary.totals.charged_piastres).toBe(0);
    });
  });

  describe('who may see a fee', () => {
    it('shows a parent their own child and refuses another', async () => {
      const { admin, squad, plan } = await setUp();
      await generate(plan.id, admin.token);
      const parent = await seedUser('parent');
      await testEnv.DB.prepare('INSERT INTO user_children (user_id, player_id, created_at) VALUES (?, ?, ?)').bind(parent.id, squad[0]!.id, now).run();

      const mine = await (await request('/api/v1/fee-charges', json('GET', undefined, parent.token))).json<{ items: { player: { id: string } }[] }>();
      expect(mine.items).toHaveLength(1);
      expect(mine.items[0]?.player.id).toBe(squad[0]!.id);

      const theirs = await request(`/api/v1/fee-charges?player_id=${squad[1]!.id}`, json('GET', undefined, parent.token));
      expect(theirs.status).toBe(403);
      expect(await theirs.json()).toMatchObject({ detail: { code: 'player_access_denied' } });
    });

    it('lets nobody but an administrator raise a charge or take money', async () => {
      const { admin, squad, plan } = await setUp();
      await generate(plan.id, admin.token);
      const playerUser = await seedUser('player', squad[0]!.id);
      const charge = (await chargesFor(squad[0]!.id, admin.token))[0]!;
      expect((await pay(charge.id, playerUser.token, 1000)).status).toBe(403);
      expect((await request('/api/v1/fee-charges', json('POST', { player_id: squad[0]!.id, label: 'x', amount_piastres: 100, due_on: '2026-10-01' }, playerUser.token))).status).toBe(403);
      expect((await request(`/api/v1/teams/${squad[0]!.id}/fee-summary`, json('GET', undefined, playerUser.token))).status).toBe(403);
    });
  });
});

describe('player reports', () => {
  const setUp = async () => {
    const admin = await seedUser('admin');
    const team = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U12', is_aimz: true }, admin.token))).json<{ id: string }>();
    const mine = await (await request('/api/v1/players', json('POST', { name: 'Layla', team_id: team.id, position: 'CM' }, admin.token))).json<{ id: string }>();
    const other = await (await request('/api/v1/players', json('POST', { name: 'Somebody Else', team_id: team.id, position: 'ST' }, admin.token))).json<{ id: string }>();
    const parent = await seedUser('parent');
    await testEnv.DB.prepare('INSERT INTO user_children (user_id, player_id, created_at) VALUES (?, ?, ?)').bind(parent.id, mine.id, now).run();
    return { admin, team, mine, other, parent };
  };

  const draft = async (playerId: string, token: string, over: Record<string, unknown> = {}) =>
    (await request('/api/v1/player-reports', json('POST', {
      player_id: playerId, title: 'Autumn term', period_start: '2026-09-01', period_end: '2026-12-20',
      coach_feedback: 'Reads the game well.', ...over,
    }, token))).json<{ id: string; status: string; share_token: string | null; snapshot_source: string }>();

  const publish = (id: string, token: string) => request(`/api/v1/player-reports/${id}/publish`, json('POST', {}, token));

  it('starts as a draft with no link, measured live', async () => {
    const { admin, mine } = await setUp();
    const report = await draft(mine.id, admin.token);
    expect(report).toMatchObject({ status: 'draft', share_token: null, snapshot_source: 'live' });
  });

  it('mints a link when published, and answers it to a stranger', async () => {
    const { admin, mine } = await setUp();
    const report = await draft(mine.id, admin.token);
    const published = await (await publish(report.id, admin.token)).json<{ share_token: string; status: string }>();
    expect(published.status).toBe('published');
    expect(published.share_token).toHaveLength(43);

    // No Authorization header at all: the address is the whole credential.
    const shared = await request(`/api/v1/reports/${published.share_token}`, json('GET'));
    expect(shared.status).toBe(200);
    expect(await shared.json()).toMatchObject({
      title: 'Autumn term',
      coach_feedback: 'Reads the game well.',
      snapshot: { version: 2, player: { name: 'Layla' } },
    });
  });

  // A link gets forwarded. It must not also be a key to anything else.
  it('puts no identifiers on the shared link', async () => {
    const { admin, mine } = await setUp();
    const report = await draft(mine.id, admin.token);
    const published = await (await publish(report.id, admin.token)).json<{ share_token: string }>();
    const body = await (await request(`/api/v1/reports/${published.share_token}`, json('GET'))).json<Record<string, unknown>>();
    for (const key of ['id', 'player_id', 'team_id', 'share_token']) expect(body[key]).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(mine.id);
  });

  // A report is about the whole of a term, not only the matches in it.
  it('carries the training marks given inside the period', async () => {
    const { admin, team, mine } = await setUp();
    const sessions = await (await request('/api/v1/training-sessions', json('POST', {
      team_id: team.id, venue: 'Palm', notes: null, duration_minutes: 90,
      occurrences: ['2026-10-01T15:00:00.000Z', '2026-10-08T15:00:00.000Z'],
    }, admin.token))).json<{ id: string }[]>();
    const metrics = await (await request('/api/v1/training-metrics', json('GET', undefined, admin.token))).json<{ items: { id: string; key: string }[] }>();
    const dribbling = metrics.items.find((metric) => metric.key === 'dribbling')!;
    const minutes = metrics.items.find((metric) => metric.key === 'minutes_trained')!;
    for (const [index, mark] of [6, 9].entries()) {
      await request(`/api/v1/training-sessions/${sessions[index]!.id}/performance`, json('PUT', {
        entries: [{ player_id: mine.id, metric_id: dribbling.id, value: mark }, { player_id: mine.id, metric_id: minutes.id, value: 90 }],
      }, admin.token));
    }

    const report = await draft(mine.id, admin.token);
    const published = await (await publish(report.id, admin.token)).json<{ share_token: string }>();
    const body = await (await request(`/api/v1/reports/${published.share_token}`, json('GET'))).json<{ snapshot: { version: number; training: { key: string; value: number; sessions: number }[] } }>();

    expect(body.snapshot.version).toBe(2);
    // A rating averages, a count adds up.
    expect(body.snapshot.training.find((row) => row.key === 'dribbling')).toMatchObject({ value: 7.5, sessions: 2 });
    expect(body.snapshot.training.find((row) => row.key === 'minutes_trained')).toMatchObject({ value: 180, sessions: 2 });
  });

  it('leaves the marks out of a period they were not given in', async () => {
    const { admin, team, mine } = await setUp();
    const sessions = await (await request('/api/v1/training-sessions', json('POST', {
      team_id: team.id, venue: 'Palm', notes: null, duration_minutes: 90, occurrences: ['2027-03-01T15:00:00.000Z'],
    }, admin.token))).json<{ id: string }[]>();
    const metrics = await (await request('/api/v1/training-metrics', json('GET', undefined, admin.token))).json<{ items: { id: string; key: string }[] }>();
    const dribbling = metrics.items.find((metric) => metric.key === 'dribbling')!;
    await request(`/api/v1/training-sessions/${sessions[0]!.id}/performance`, json('PUT', { entries: [{ player_id: mine.id, metric_id: dribbling.id, value: 9 }] }, admin.token));

    // The report runs to December; the session is in March.
    const report = await draft(mine.id, admin.token);
    const published = await (await publish(report.id, admin.token)).json<{ share_token: string }>();
    const body = await (await request(`/api/v1/reports/${published.share_token}`, json('GET'))).json<{ snapshot: { training: unknown[] } }>();
    expect(body.snapshot.training).toEqual([]);
  });

  it('carries the fee standing the academy asked for', async () => {
    const { admin, mine } = await setUp();
    await request('/api/v1/fee-charges', json('POST', { player_id: mine.id, label: 'Kit', amount_piastres: 40000, due_on: '2026-10-01' }, admin.token));
    const report = await draft(mine.id, admin.token);
    const published = await (await publish(report.id, admin.token)).json<{ share_token: string }>();
    const body = await (await request(`/api/v1/reports/${published.share_token}`, json('GET'))).json<{ snapshot: { fees: { charged_piastres: number; outstanding_piastres: number } } }>();
    expect(body.snapshot.fees).toMatchObject({ charged_piastres: 40000, outstanding_piastres: 40000 });
  });

  // The whole reason for freezing: a report is a statement made on a date.
  it('keeps saying what it said after the underlying record changes', async () => {
    const { admin, team, mine } = await setUp();
    const sessions = await (await request('/api/v1/training-sessions', json('POST', {
      team_id: team.id, venue: 'Palm', notes: null, duration_minutes: 90, occurrences: ['2026-10-01T15:00:00.000Z'],
    }, admin.token))).json<{ id: string }[]>();
    await request(`/api/v1/training-sessions/${sessions[0]!.id}/attendance`, json('PUT', { entries: [{ player_id: mine.id, status: 'present' }] }, admin.token));

    const report = await draft(mine.id, admin.token);
    const published = await (await publish(report.id, admin.token)).json<{ share_token: string }>();
    const before = await (await request(`/api/v1/reports/${published.share_token}`, json('GET'))).json<{ snapshot: { attendance: { attended: number; expected: number } } }>();
    expect(before.snapshot.attendance).toMatchObject({ attended: 1, expected: 1 });

    // Somebody back-marks the register after the report went out.
    await request(`/api/v1/training-sessions/${sessions[0]!.id}/attendance`, json('PUT', { entries: [{ player_id: mine.id, status: 'absent' }] }, admin.token));
    const after = await (await request(`/api/v1/reports/${published.share_token}`, json('GET'))).json<{ snapshot: { attendance: { attended: number } } }>();
    expect(after.snapshot.attendance.attended).toBe(1);
  });

  it('replaces the link on request, and the old address stops working', async () => {
    const { admin, mine } = await setUp();
    const report = await draft(mine.id, admin.token);
    const first = await (await publish(report.id, admin.token)).json<{ share_token: string }>();
    const second = await (await request(`/api/v1/player-reports/${report.id}/new-link`, json('POST', {}, admin.token))).json<{ share_token: string }>();

    expect(second.share_token).not.toBe(first.share_token);
    expect((await request(`/api/v1/reports/${first.share_token}`, json('GET'))).status).toBe(404);
    expect((await request(`/api/v1/reports/${second.share_token}`, json('GET'))).status).toBe(200);
  });

  it('takes the link away when the report is withdrawn', async () => {
    const { admin, mine } = await setUp();
    const report = await draft(mine.id, admin.token);
    const published = await (await publish(report.id, admin.token)).json<{ share_token: string }>();
    await request(`/api/v1/player-reports/${report.id}/withdraw`, json('POST', {}, admin.token));
    expect((await request(`/api/v1/reports/${published.share_token}`, json('GET'))).status).toBe(404);
  });

  it('records that somebody opened it, once', async () => {
    const { admin, mine } = await setUp();
    const report = await draft(mine.id, admin.token);
    const published = await (await publish(report.id, admin.token)).json<{ share_token: string }>();
    await request(`/api/v1/reports/${published.share_token}`, json('GET'));
    const first = await testEnv.DB.prepare('SELECT first_opened_at FROM player_reports WHERE id=?').bind(report.id).first<{ first_opened_at: string }>();
    expect(first?.first_opened_at).toBeTruthy();
    await request(`/api/v1/reports/${published.share_token}`, json('GET'));
    const again = await testEnv.DB.prepare('SELECT first_opened_at FROM player_reports WHERE id=?').bind(report.id).first<{ first_opened_at: string }>();
    expect(again?.first_opened_at).toBe(first?.first_opened_at);
  });

  it('refuses an address that is not a report', async () => {
    expect((await request('/api/v1/reports/not-a-real-token', json('GET'))).status).toBe(404);
  });

  describe('who may read one', () => {
    it('shows a parent their own child once it is published', async () => {
      const { admin, mine, parent } = await setUp();
      const report = await draft(mine.id, admin.token);
      // While it is a draft the coach is still deciding what to say.
      expect((await request(`/api/v1/player-reports/${report.id}`, json('GET', undefined, parent.token))).status).toBe(403);
      const listedAsDraft = await (await request('/api/v1/player-reports', json('GET', undefined, parent.token))).json<{ total: number }>();
      expect(listedAsDraft.total).toBe(0);

      await publish(report.id, admin.token);
      expect((await request(`/api/v1/player-reports/${report.id}`, json('GET', undefined, parent.token))).status).toBe(200);
    });

    // The security test that matters most: squad scope would fail this.
    it('refuses a parent another family on the same squad', async () => {
      const { admin, other, parent } = await setUp();
      const report = await draft(other.id, admin.token);
      await publish(report.id, admin.token);
      const response = await request(`/api/v1/player-reports/${report.id}`, json('GET', undefined, parent.token));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ detail: { code: 'player_access_denied' } });
    });

    it('lets nobody but an administrator write one', async () => {
      const { mine, parent } = await setUp();
      expect((await request('/api/v1/player-reports', json('POST', {
        player_id: mine.id, title: 'Mine', period_start: '2026-09-01', period_end: '2026-12-20',
      }, parent.token))).status).toBe(403);
    });
  });

  it('will not quietly change a report already sent', async () => {
    const { admin, mine } = await setUp();
    const report = await draft(mine.id, admin.token);
    await publish(report.id, admin.token);
    const edit = await request(`/api/v1/player-reports/${report.id}`, json('PATCH', { coach_feedback: 'Changed my mind.' }, admin.token));
    expect(edit.status).toBe(409);
    expect((await request(`/api/v1/player-reports/${report.id}`, json('DELETE', undefined, admin.token))).status).toBe(409);
  });

  it('refuses a period that ends before it starts', async () => {
    const { admin, mine } = await setUp();
    const response = await request('/api/v1/player-reports', json('POST', {
      player_id: mine.id, title: 'Backwards', period_start: '2026-12-20', period_end: '2026-09-01',
    }, admin.token));
    expect(response.status).toBe(422);
  });
});

describe('training performance', () => {
  const setUp = async () => {
    const admin = await seedUser('admin');
    const team = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U10', is_aimz: true }, admin.token))).json<{ id: string }>();
    const squad: { id: string; name: string }[] = [];
    for (const name of ['Hana', 'Malak']) {
      squad.push(await (await request('/api/v1/players', json('POST', { name, team_id: team.id, position: 'CM' }, admin.token))).json<{ id: string; name: string }>());
    }
    const sessions = await (await request('/api/v1/training-sessions', json('POST', {
      team_id: team.id, venue: 'Palm', notes: null, duration_minutes: 90,
      occurrences: ['2026-09-01T15:00:00.000Z', '2026-09-03T15:00:00.000Z'],
    }, admin.token))).json<{ id: string }[]>();
    return { admin, team, squad, sessions };
  };

  const metricsOf = async (token: string) =>
    (await (await request('/api/v1/training-metrics', json('GET', undefined, token))).json<{ items: { id: string; key: string; kind: string; min_value: number | null; max_value: number | null }[] }>()).items;

  const record = (sessionId: string, token: string, entries: unknown[]) =>
    request(`/api/v1/training-sessions/${sessionId}/performance`, json('PUT', { entries }, token));

  const statsOf = async (playerId: string, token: string) =>
    (await request(`/api/v1/players/${playerId}/training-stats`, json('GET', undefined, token))).json<{
      attendance: { attended: number; expected: number; pct: number | null };
      totals: { metric: { key: string; kind: string }; value: number | null; sessions: number }[];
      sessions: { id: string; status: string | null; values: Record<string, number> }[];
    }>();

  it('offers the metrics the academy starts with, in reading order', async () => {
    const admin = await seedUser('admin');
    const metrics = await metricsOf(admin.token);
    expect(metrics.map((metric) => metric.key)).toEqual(['minutes_trained', 'dribbling', 'shooting', 'passing']);
    const dribbling = metrics.find((metric) => metric.key === 'dribbling')!;
    // The scale lives on the metric, so changing it later is a row not a release.
    expect(dribbling).toMatchObject({ kind: 'rating', min_value: 1, max_value: 10 });
    expect(metrics.find((metric) => metric.key === 'minutes_trained')).toMatchObject({ kind: 'count', min_value: null });
  });

  it('hands back the whole squad to mark, before anybody is marked', async () => {
    const { admin, squad, sessions } = await setUp();
    const body = await (await request(`/api/v1/training-sessions/${sessions[0]!.id}/performance`, json('GET', undefined, admin.token))).json<{ items: { player: { id: string }; values: Record<string, number> }[]; metrics: unknown[] }>();
    expect(body.items).toHaveLength(squad.length);
    expect(body.metrics).toHaveLength(4);
    expect(body.items[0]?.values).toEqual({});
  });

  it('records readings and reads them back', async () => {
    const { admin, squad, sessions } = await setUp();
    const metrics = await metricsOf(admin.token);
    const dribbling = metrics.find((metric) => metric.key === 'dribbling')!;
    const minutes = metrics.find((metric) => metric.key === 'minutes_trained')!;

    const response = await record(sessions[0]!.id, admin.token, [
      { player_id: squad[0]!.id, metric_id: dribbling.id, value: 7 },
      { player_id: squad[0]!.id, metric_id: minutes.id, value: 75 },
    ]);
    expect(response.status).toBe(200);
    const body = await response.json<{ items: { player: { id: string }; values: Record<string, number> }[] }>();
    const mine = body.items.find((item) => item.player.id === squad[0]!.id)!;
    expect(mine.values[dribbling.id]).toBe(7);
    expect(mine.values[minutes.id]).toBe(75);
  });

  it('changes one reading without disturbing the rest', async () => {
    const { admin, squad, sessions } = await setUp();
    const metrics = await metricsOf(admin.token);
    const [minutes, dribbling] = [metrics[0]!, metrics[1]!];
    await record(sessions[0]!.id, admin.token, [
      { player_id: squad[0]!.id, metric_id: minutes.id, value: 90 },
      { player_id: squad[0]!.id, metric_id: dribbling.id, value: 6 },
    ]);
    const after = await (await record(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, metric_id: dribbling.id, value: 9 }]))
      .json<{ items: { player: { id: string }; values: Record<string, number> }[] }>();
    const mine = after.items.find((item) => item.player.id === squad[0]!.id)!;
    expect(mine.values[dribbling.id]).toBe(9);
    expect(mine.values[minutes.id]).toBe(90);
  });

  // A zero is a mark out of ten, not an absence of one.
  it('clears a reading when it is sent as null, rather than storing nothing as zero', async () => {
    const { admin, squad, sessions } = await setUp();
    const dribbling = (await metricsOf(admin.token)).find((metric) => metric.key === 'dribbling')!;
    await record(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, metric_id: dribbling.id, value: 8 }]);
    const after = await (await record(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, metric_id: dribbling.id, value: null }]))
      .json<{ items: { player: { id: string }; values: Record<string, number> }[] }>();
    expect(after.items.find((item) => item.player.id === squad[0]!.id)!.values[dribbling.id]).toBeUndefined();
  });

  it('refuses a mark outside the scale the metric carries', async () => {
    const { admin, squad, sessions } = await setUp();
    const dribbling = (await metricsOf(admin.token)).find((metric) => metric.key === 'dribbling')!;
    const response = await record(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, metric_id: dribbling.id, value: 11 }]);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ detail: { field_errors: [{ field: 'dribbling', message: 'Enter 1 to 10.' }] } });
  });

  it('refuses a player who is not on this squad, and a metric that is not one', async () => {
    const { admin, sessions, team } = await setUp();
    const dribbling = (await metricsOf(admin.token)).find((metric) => metric.key === 'dribbling')!;
    const other = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U8', is_aimz: true }, admin.token))).json<{ id: string }>();
    const outsider = await (await request('/api/v1/players', json('POST', { name: 'Stranger', team_id: other.id, position: 'ST' }, admin.token))).json<{ id: string }>();
    expect((await record(sessions[0]!.id, admin.token, [{ player_id: outsider.id, metric_id: dribbling.id, value: 5 }])).status).toBe(422);
    expect((await record(sessions[0]!.id, admin.token, [{ player_id: team.id, metric_id: 'not-a-metric', value: 5 }])).status).toBe(422);
  });

  it('lets nobody but an administrator record readings', async () => {
    const { admin, squad, sessions } = await setUp();
    const dribbling = (await metricsOf(admin.token)).find((metric) => metric.key === 'dribbling')!;
    const playerUser = await seedUser('player', squad[0]!.id);
    expect((await record(sessions[0]!.id, playerUser.token, [{ player_id: squad[0]!.id, metric_id: dribbling.id, value: 5 }])).status).toBe(403);
    // Reading is fine: a player sees their own squad's session.
    expect((await request(`/api/v1/training-sessions/${sessions[0]!.id}/performance`, json('GET', undefined, playerUser.token))).status).toBe(200);
  });

  describe('one player\'s training record', () => {
    it('averages a rating and adds up a count', async () => {
      const { admin, squad, sessions } = await setUp();
      const metrics = await metricsOf(admin.token);
      const dribbling = metrics.find((metric) => metric.key === 'dribbling')!;
      const minutes = metrics.find((metric) => metric.key === 'minutes_trained')!;
      await record(sessions[0]!.id, admin.token, [
        { player_id: squad[0]!.id, metric_id: dribbling.id, value: 6 },
        { player_id: squad[0]!.id, metric_id: minutes.id, value: 90 },
      ]);
      await record(sessions[1]!.id, admin.token, [
        { player_id: squad[0]!.id, metric_id: dribbling.id, value: 9 },
        { player_id: squad[0]!.id, metric_id: minutes.id, value: 60 },
      ]);

      const stats = await statsOf(squad[0]!.id, admin.token);
      const drib = stats.totals.find((total) => total.metric.key === 'dribbling')!;
      const mins = stats.totals.find((total) => total.metric.key === 'minutes_trained')!;
      // Averaging minutes, or adding up marks out of ten, would each mean nothing.
      expect(drib).toMatchObject({ value: 7.5, sessions: 2 });
      expect(mins).toMatchObject({ value: 150, sessions: 2 });
    });

    it('counts attendance from the register rather than as a metric of its own', async () => {
      const { admin, squad, sessions } = await setUp();
      await request(`/api/v1/training-sessions/${sessions[0]!.id}/attendance`, json('PUT', { entries: [{ player_id: squad[0]!.id, status: 'present' }] }, admin.token));
      await request(`/api/v1/training-sessions/${sessions[1]!.id}/attendance`, json('PUT', { entries: [{ player_id: squad[0]!.id, status: 'absent' }] }, admin.token));
      const stats = await statsOf(squad[0]!.id, admin.token);
      expect(stats.attendance).toMatchObject({ attended: 1, expected: 2, pct: 50 });
    });

    it('lists the sessions newest first, carrying both the mark and the register', async () => {
      const { admin, squad, sessions } = await setUp();
      const dribbling = (await metricsOf(admin.token)).find((metric) => metric.key === 'dribbling')!;
      await request(`/api/v1/training-sessions/${sessions[1]!.id}/attendance`, json('PUT', { entries: [{ player_id: squad[0]!.id, status: 'present' }] }, admin.token));
      await record(sessions[1]!.id, admin.token, [{ player_id: squad[0]!.id, metric_id: dribbling.id, value: 8 }]);

      const stats = await statsOf(squad[0]!.id, admin.token);
      expect(stats.sessions[0]).toMatchObject({ id: sessions[1]!.id, status: 'present' });
      expect(stats.sessions[0]!.values[dribbling.id]).toBe(8);
    });

    it('says nothing rather than zero for a metric never recorded', async () => {
      const { admin, squad } = await setUp();
      const stats = await statsOf(squad[0]!.id, admin.token);
      expect(stats.attendance.pct).toBeNull();
      for (const total of stats.totals) expect(total).toMatchObject({ value: null, sessions: 0 });
    });

    it('shows a parent their own child and refuses another', async () => {
      const { admin, squad } = await setUp();
      const parent = await seedUser('parent');
      await testEnv.DB.prepare('INSERT INTO user_children (user_id, player_id, created_at) VALUES (?, ?, ?)').bind(parent.id, squad[0]!.id, now).run();
      expect((await request(`/api/v1/players/${squad[0]!.id}/training-stats`, json('GET', undefined, parent.token))).status).toBe(200);
      const theirs = await request(`/api/v1/players/${squad[1]!.id}/training-stats`, json('GET', undefined, parent.token));
      expect(theirs.status).toBe(403);
    });

    it('is shut to a stranger, like everything else', async () => {
      const { squad } = await setUp();
      expect((await request(`/api/v1/players/${squad[0]!.id}/training-stats`, json('GET'))).status).toBe(401);
      expect((await request('/api/v1/training-metrics', json('GET'))).status).toBe(401);
    });

    it('goes away with the session it belongs to', async () => {
      const { admin, squad, sessions } = await setUp();
      const dribbling = (await metricsOf(admin.token)).find((metric) => metric.key === 'dribbling')!;
      await record(sessions[0]!.id, admin.token, [{ player_id: squad[0]!.id, metric_id: dribbling.id, value: 5 }]);
      await request(`/api/v1/training-sessions/${sessions[0]!.id}`, json('DELETE', undefined, admin.token));
      const left = await testEnv.DB.prepare('SELECT COUNT(*) n FROM training_player_metrics WHERE training_session_id = ?').bind(sessions[0]!.id).first<{ n: number }>();
      expect(left?.n).toBe(0);
    });
  });
});

describe('a player read against their own squad', () => {
  /**
   * The figure this exists for. A percentage on its own says nothing — 80% in a
   * squad averaging 95 is not 80% in one averaging 60 — so the squad's own
   * ratio comes back beside it. A join that forgot `team_id` would quietly
   * return the academy's average, and every number on the page would still look
   * plausible.
   */
  it('averages the whole squad, not the reader, and not the academy', async () => {
    const admin = await seedUser('admin');
    const squad = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U12', is_aimz: true }, admin.token))).json<{ id: string }>();
    const elsewhere = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U18', is_aimz: true }, admin.token))).json<{ id: string }>();
    const always = await (await request('/api/v1/players', json('POST', { name: 'Salma', team_id: squad.id, position: 'ST' }, admin.token))).json<{ id: string }>();
    const sometimes = await (await request('/api/v1/players', json('POST', { name: 'Hana', team_id: squad.id, position: 'CM' }, admin.token))).json<{ id: string }>();
    // On another squad, and absent from everything: if she were counted the
    // squad average would come out lower than it should.
    const outsider = await (await request('/api/v1/players', json('POST', { name: 'Layla', team_id: elsewhere.id, position: 'GK' }, admin.token))).json<{ id: string }>();

    const ours = await (await request('/api/v1/training-sessions', json('POST', { team_id: squad.id, venue: 'Palm', notes: null, duration_minutes: 60, occurrences: ['2026-08-25T15:00:00.000Z', '2026-08-27T15:00:00.000Z'] }, admin.token))).json<{ id: string }[]>();
    const theirs = await (await request('/api/v1/training-sessions', json('POST', { team_id: elsewhere.id, venue: 'Palm', notes: null, duration_minutes: 60, occurrences: ['2026-08-26T15:00:00.000Z'] }, admin.token))).json<{ id: string }[]>();

    // Salma turns up twice; Hana once out of two. Three present of four marked.
    await request(`/api/v1/training-sessions/${ours[0]!.id}/attendance`, json('PUT', { entries: [{ player_id: always.id, status: 'present' }, { player_id: sometimes.id, status: 'present' }] }, admin.token));
    await request(`/api/v1/training-sessions/${ours[1]!.id}/attendance`, json('PUT', { entries: [{ player_id: always.id, status: 'present' }, { player_id: sometimes.id, status: 'absent' }] }, admin.token));
    await request(`/api/v1/training-sessions/${theirs[0]!.id}/attendance`, json('PUT', { entries: [{ player_id: outsider.id, status: 'absent' }] }, admin.token));

    const perfect = await (await request(`/api/v1/players/${always.id}/training-stats`, json('GET', undefined, admin.token))).json<{ attendance: { pct: number; team_pct: number } }>();
    expect(perfect.attendance).toMatchObject({ pct: 100, team_pct: 75 });

    // The same squad figure whoever is being read, so two players compare.
    const patchy = await (await request(`/api/v1/players/${sometimes.id}/training-stats`, json('GET', undefined, admin.token))).json<{ attendance: { pct: number; team_pct: number } }>();
    expect(patchy.attendance).toMatchObject({ pct: 50, team_pct: 75 });

    // Her own squad has one absence and nothing else, which is nobody else's 75.
    const away = await (await request(`/api/v1/players/${outsider.id}/training-stats`, json('GET', undefined, admin.token))).json<{ attendance: { pct: number; team_pct: number } }>();
    expect(away.attendance).toMatchObject({ pct: 0, team_pct: 0 });
  });

  it('leaves the squad figure empty rather than nought when no register exists', async () => {
    const admin = await seedUser('admin');
    const squad = await (await request('/api/v1/teams', json('POST', { name: 'AIMZ U10', is_aimz: true }, admin.token))).json<{ id: string }>();
    const player = await (await request('/api/v1/players', json('POST', { name: 'Nour', team_id: squad.id, position: 'ST' }, admin.token))).json<{ id: string }>();

    const stats = await (await request(`/api/v1/players/${player.id}/training-stats`, json('GET', undefined, admin.token))).json<{ attendance: { pct: null; team_pct: null } }>();
    // Nought would read as a squad that never turns up, rather than one nobody
    // has taken a register for yet.
    expect(stats.attendance).toMatchObject({ pct: null, team_pct: null });
  });
});
