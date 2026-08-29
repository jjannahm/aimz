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
    expect(applied.results.at(-1)?.name).toBe('0021_positions_and_stat_team.sql');
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

    // No minutes were ever saved, so nothing wrote an `appeared` flag for her.
    const stats = await (await request(`/api/v1/matches/${match.id}/player-stats`, json('GET', undefined, admin.token))).json<{ player_id: string }[]>();
    expect(stats.some((stat) => stat.player_id === quiet.id)).toBe(false);

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
  });
});
