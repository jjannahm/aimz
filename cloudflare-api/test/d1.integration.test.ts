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

async function seedUser(role: 'admin' | 'player', playerId: string | null = null): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  await testEnv.DB.prepare('INSERT INTO users (id, name, email, password_hash, role, player_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .bind(id, role === 'admin' ? 'Test Admin' : 'Test Player', `${id}@aimz.test`, 'unused', role, playerId, now, now).run();
  return { id, token: await createAccessToken(id, role, testEnv.JWT_SECRET, 900) };
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, JSON.parse(testEnv.TEST_MIGRATIONS));
});

describe('D1 migrations and opponent results', () => {
  it('applies the numbered migration chain and uses result as the only score path', async () => {
    const applied = await testEnv.DB.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>();
    expect(applied.results.at(-1)?.name).toBe('0018_player_contacts.sql');
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
    const player = await (await request('/api/v1/players', json('POST', { name: 'Mariam', team_id: team.id, position: 'Forward' }, admin.token))).json<{ id: string }>();
    const playerUser = await seedUser('player', player.id);

    const created = await request('/api/v1/training-sessions', json('POST', { team_id: team.id, venue: 'AIMZ Ground', notes: null, duration_minutes: 90, occurrences: ['2026-08-25T15:00:00.000Z', '2026-08-27T15:00:00.000Z'] }, admin.token));
    expect(created.status).toBe(201);
    const sessions = await created.json<{ id: string; series_id: string }[]>();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.series_id).toBe(sessions[1]?.series_id);

    const firstRsvp = await request(`/api/v1/training-sessions/${sessions[0]!.id}/availability`, json('PUT', { status: 'going', note: null }, playerUser.token));
    expect(firstRsvp.status).toBe(200);
    await request(`/api/v1/training-sessions/${sessions[0]!.id}/availability`, json('PUT', { status: 'maybe', note: 'School' }, playerUser.token));
    const rsvps = await (await request(`/api/v1/training-sessions/${sessions[0]!.id}/availability`, json('GET', undefined, playerUser.token))).json<{ status: string; note: string }[]>();
    expect(rsvps).toEqual([expect.objectContaining({ status: 'maybe', note: 'School' })]);

    const slot = await request(`/api/v1/training-sessions/${sessions[0]!.id}/assignments`, json('POST', { title: 'Bring bibs', assigned_player_id: null }, admin.token));
    expect(slot.status).toBe(201);
    const assignment = await slot.json<{ id: string }>();
    const claim = await request(`/api/v1/event-assignments/${assignment.id}`, json('PATCH', { assigned_player_id: player.id }, playerUser.token));
    expect(await claim.json()).toMatchObject({ assigned_player_id: player.id });
    const release = await request(`/api/v1/event-assignments/${assignment.id}`, json('PATCH', { assigned_player_id: null }, playerUser.token));
    expect(await release.json()).toMatchObject({ assigned_player_id: null });

    await request('/api/v1/announcements', json('POST', { team_id: null, title: 'Academy update', body: 'For everyone', pinned: false }, admin.token));
    await request('/api/v1/announcements', json('POST', { team_id: team.id, title: 'U14 priority', body: 'Meet early', pinned: true }, admin.token));
    await request('/api/v1/announcements', json('POST', { team_id: otherTeam.id, title: 'U16 only', body: 'Different squad', pinned: true }, admin.token));
    const visible = await (await request('/api/v1/announcements?limit=100', json('GET', undefined, playerUser.token))).json<{ items: { title: string; pinned: boolean; author_name: string }[] }>();
    expect(visible.items.map((announcement) => announcement.title)).toEqual(['U14 priority', 'Academy update']);
    expect(visible.items[0]).toMatchObject({ pinned: true, author_name: 'Test Admin' });

    const accounts = await (await request('/api/v1/admin/users?limit=100', json('GET', undefined, admin.token))).json<{ items: { id: string; player: { id: string } | null; team: { id: string } | null }[] }>();
    expect(accounts.items.find((account) => account.id === playerUser.id)).toMatchObject({ player: { id: player.id }, team: { id: team.id } });
    const unlinked = await seedUser('player');
    const conflict = await request(`/api/v1/admin/users/${unlinked.id}`, json('PATCH', { player_id: player.id }, admin.token));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ detail: { code: 'player_already_linked' } });

    const invitedPlayer = await (await request('/api/v1/players', json('POST', { name: 'Nour', team_id: team.id, position: 'Keeper' }, admin.token))).json<{ id: string }>();
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
