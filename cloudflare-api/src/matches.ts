import type { Hono } from "hono";
import { ApiProblem, adminUser, booleanField, enumField, jsonArray, jsonObject, nowIso, numberField, publicPlayer, publicTeam, stringField } from "./helpers";
import { getJoinedMatch, joinedMatch } from "./domain";
import type { CompetitionRow, EventRow, LineupRow, MatchRow, PlayerRow, StatRow, TeamRow } from "./types";

type App = Hono<{ Bindings: Env }>;

function publicEvent(event: EventRow): Record<string, unknown> {
  return { ...event, is_penalty: Boolean(event.is_penalty) };
}

function publicLineup(entry: LineupRow): Record<string, unknown> {
  return { ...entry, is_starter: Boolean(entry.is_starter) };
}

function publicStat(stat: StatRow): Record<string, unknown> {
  return { ...stat, appeared: Boolean(stat.appeared) };
}

export function registerMatchRoutes(app: App): void {
  app.get("/api/v1/matches/:id/live", async (c) => {
    const match = await getJoinedMatch(c.env, c.req.param("id"));
    const etag = `W/\"${match.id}-${match.revision}\"`;
    if (c.req.header("If-None-Match") === etag) return c.body(null, 304);
    const [events, lineup] = await Promise.all([
      c.env.DB.prepare("SELECT * FROM match_events WHERE match_id = ? ORDER BY COALESCE(minute, 999), created_at").bind(match.id).all<EventRow>(),
      c.env.DB.prepare("SELECT * FROM match_lineup_entries WHERE match_id = ? ORDER BY is_starter DESC, jersey_number, player_id").bind(match.id).all<LineupRow>(),
    ]);
    c.header("ETag", etag);
    c.header("Cache-Control", "private, no-cache");
    return c.json({
      match: joinedMatch(match),
      events: events.results.map(publicEvent),
      lineup: lineup.results.map(publicLineup),
      revision: match.revision,
    });
  });

  app.get("/api/v1/matches/:id/events", async (c) => {
    await getJoinedMatch(c.env, c.req.param("id"));
    const result = await c.env.DB.prepare("SELECT * FROM match_events WHERE match_id = ? ORDER BY COALESCE(minute, 999), created_at").bind(c.req.param("id")).all<EventRow>();
    return c.json(result.results.map(publicEvent));
  });

  app.post("/api/v1/matches/:id/events", async (c) => {
    await adminUser(c);
    const match = await getJoinedMatch(c.env, c.req.param("id"));
    const body = await jsonObject(c);
    const operationId = stringField(body, "client_operation_id", { min: 8, max: 64 })!;
    const duplicate = await c.env.DB.prepare("SELECT * FROM match_events WHERE client_operation_id = ?").bind(operationId).first<EventRow>();
    if (duplicate) return c.json(publicEvent(duplicate));

    const type = enumField(body, "type", ["goal", "assist", "yellow_card", "red_card", "substitution"] as const);
    const teamId = stringField(body, "team_id", { min: 1, max: 36 })!;
    if (teamId !== match.home_team_id && teamId !== match.away_team_id) throw new ApiProblem(422, "invalid_team", "The event team must be part of this match.");
    const minute = numberField(body, "minute", { optional: true, nullable: true, min: 0, max: 150 }) ?? null;
    const playerId = stringField(body, "player_id", { optional: true, nullable: true, max: 36 }) ?? null;
    const secondaryPlayerId = stringField(body, "secondary_player_id", { optional: true, nullable: true, max: 36 }) ?? null;
    if (playerId) await requirePlayerOnTeam(c.env, playerId, teamId);
    if (secondaryPlayerId) await requirePlayerOnTeam(c.env, secondaryPlayerId, teamId);
    const now = nowIso();
    const event: EventRow = {
      id: crypto.randomUUID(), match_id: match.id, type, minute, team_id: teamId,
      player_id: playerId, secondary_player_id: secondaryPlayerId,
      related_event_id: stringField(body, "related_event_id", { optional: true, nullable: true, max: 36 }) ?? null,
      notes: stringField(body, "notes", { optional: true, nullable: true, max: 1000 }) ?? null,
      is_penalty: booleanField(body, "is_penalty", false) ? 1 : 0,
      client_operation_id: operationId, created_at: now, updated_at: now,
    };

    const statements = [
      c.env.DB.prepare("INSERT INTO match_events (id, match_id, type, minute, team_id, player_id, secondary_player_id, related_event_id, notes, is_penalty, client_operation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(event.id, event.match_id, event.type, event.minute, event.team_id, event.player_id, event.secondary_player_id, event.related_event_id, event.notes, event.is_penalty, event.client_operation_id, now, now),
    ];
    const counter = eventCounter(type);
    if (playerId && counter) {
      statements.push(c.env.DB.prepare(`
        INSERT INTO player_match_stats (id, match_id, player_id, appeared, minutes_played, goals, assists, yellow_cards, red_cards, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(match_id, player_id) DO UPDATE SET ${counter} = ${counter} + 1, appeared = 1, updated_at = excluded.updated_at
      `).bind(crypto.randomUUID(), match.id, playerId, type === "goal" ? 1 : 0, type === "assist" ? 1 : 0, type === "yellow_card" ? 1 : 0, type === "red_card" ? 1 : 0, now, now));
    }
    statements.push(scoreRecalculation(c.env, match.id, now));
    try { await c.env.DB.batch(statements); }
    catch (error) {
      const existing = await c.env.DB.prepare("SELECT * FROM match_events WHERE client_operation_id = ?").bind(operationId).first<EventRow>();
      if (existing) return c.json(publicEvent(existing));
      throw error;
    }
    return c.json(publicEvent(event), 201);
  });

  app.patch("/api/v1/matches/:matchId/events/:eventId", async (c) => {
    await adminUser(c);
    const match = await getJoinedMatch(c.env, c.req.param("matchId"));
    const current = await c.env.DB.prepare("SELECT * FROM match_events WHERE id = ? AND match_id = ?").bind(c.req.param("eventId"), match.id).first<EventRow>();
    if (!current) throw new ApiProblem(404, "event_not_found", "Match event not found.");
    const body = await jsonObject(c);
    const type = body.type === undefined ? current.type : enumField(body, "type", ["goal", "assist", "yellow_card", "red_card", "substitution"] as const);
    const teamId = stringField(body, "team_id", { optional: true, min: 1, max: 36 }) ?? current.team_id;
    if (teamId !== match.home_team_id && teamId !== match.away_team_id) throw new ApiProblem(422, "invalid_team", "The event team must be part of this match.");
    const event: EventRow = {
      ...current, type, team_id: teamId,
      minute: body.minute === undefined ? current.minute : numberField(body, "minute", { nullable: true, min: 0, max: 150 }) ?? null,
      player_id: optionalNullableText(body, "player_id", current.player_id, 36),
      secondary_player_id: optionalNullableText(body, "secondary_player_id", current.secondary_player_id, 36),
      notes: optionalNullableText(body, "notes", current.notes, 1000), updated_at: nowIso(),
    };
    if (event.player_id) await requirePlayerOnTeam(c.env, event.player_id, teamId);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE match_events SET type=?, minute=?, team_id=?, player_id=?, secondary_player_id=?, notes=?, updated_at=? WHERE id=?").bind(event.type, event.minute, event.team_id, event.player_id, event.secondary_player_id, event.notes, event.updated_at, event.id),
      scoreRecalculation(c.env, match.id, event.updated_at),
      statRecalculation(c.env, match.id, event.updated_at),
    ]);
    return c.json(publicEvent(event));
  });

  app.delete("/api/v1/matches/:matchId/events/:eventId", async (c) => {
    await adminUser(c);
    const match = await getJoinedMatch(c.env, c.req.param("matchId"));
    const exists = await c.env.DB.prepare("SELECT id FROM match_events WHERE id = ? AND match_id = ?").bind(c.req.param("eventId"), match.id).first();
    if (!exists) throw new ApiProblem(404, "event_not_found", "Match event not found.");
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM match_events WHERE id = ? AND match_id = ?").bind(c.req.param("eventId"), match.id),
      scoreRecalculation(c.env, match.id, now),
      statRecalculation(c.env, match.id, now),
    ]);
    return c.body(null, 204);
  });

  app.put("/api/v1/matches/:id/lineup", async (c) => {
    await adminUser(c); const match = await getJoinedMatch(c.env, c.req.param("id")); const body = await jsonArray(c); const statements = [c.env.DB.prepare("DELETE FROM match_lineup_entries WHERE match_id = ?").bind(match.id)]; const output: LineupRow[] = [];
    for (const item of body) {
      const playerId = stringField(item, "player_id", { min: 1, max: 36 })!; const teamId = stringField(item, "team_id", { min: 1, max: 36 })!;
      if (teamId !== match.home_team_id && teamId !== match.away_team_id) throw new ApiProblem(422, "invalid_team", "Every lineup team must be part of this match.");
      await requirePlayerOnTeam(c.env, playerId, teamId);
      const row: LineupRow = { id: crypto.randomUUID(), match_id: match.id, player_id: playerId, team_id: teamId, is_starter: booleanField(item, "is_starter", false) ? 1 : 0, position: stringField(item, "position", { optional: true, nullable: true, max: 60 }) ?? null, jersey_number: numberField(item, "jersey_number", { optional: true, nullable: true, min: 0, max: 99 }) ?? null };
      output.push(row); statements.push(c.env.DB.prepare("INSERT INTO match_lineup_entries (id, match_id, player_id, team_id, is_starter, position, jersey_number) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(row.id, row.match_id, row.player_id, row.team_id, row.is_starter, row.position, row.jersey_number));
    }
    statements.push(c.env.DB.prepare("UPDATE matches SET revision=revision+1, updated_at=? WHERE id=?").bind(nowIso(), match.id)); await c.env.DB.batch(statements); return c.json(output.map(publicLineup));
  });

  app.put("/api/v1/matches/:id/player-stats", async (c) => {
    await adminUser(c); const match = await getJoinedMatch(c.env, c.req.param("id")); const body = await jsonArray(c); const now = nowIso(); const statements = []; const playerIds: string[] = [];
    for (const item of body) {
      const playerId = stringField(item, "player_id", { min: 1, max: 36 })!; playerIds.push(playerId);
      const appeared = booleanField(item, "appeared") ? 1 : 0; const minutes = numberField(item, "minutes_played", { min: 0, max: 150 })!;
      statements.push(c.env.DB.prepare(`INSERT INTO player_match_stats (id, match_id, player_id, appeared, minutes_played, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(match_id, player_id) DO UPDATE SET appeared=excluded.appeared, minutes_played=excluded.minutes_played, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), match.id, playerId, appeared, minutes, now, now));
    }
    statements.push(c.env.DB.prepare("UPDATE matches SET revision=revision+1, updated_at=? WHERE id=?").bind(now, match.id)); await c.env.DB.batch(statements);
    if (!playerIds.length) return c.json([]);
    const placeholders = playerIds.map(() => "?").join(","); const result = await c.env.DB.prepare(`SELECT * FROM player_match_stats WHERE match_id=? AND player_id IN (${placeholders})`).bind(match.id, ...playerIds).all<StatRow>(); return c.json(result.results.map(publicStat));
  });

  app.get("/api/v1/matches/:id/player-stats", async (c) => {
    await getJoinedMatch(c.env, c.req.param("id")); const result = await c.env.DB.prepare("SELECT * FROM player_match_stats WHERE match_id=? ORDER BY player_id").bind(c.req.param("id")).all<StatRow>(); return c.json(result.results.map(publicStat));
  });

  app.get("/api/v1/competitions/:id/standings", async (c) => {
    const competition = await c.env.DB.prepare("SELECT * FROM competitions WHERE id=?").bind(c.req.param("id")).first<CompetitionRow>();
    if (!competition) throw new ApiProblem(404, "competition_not_found", "Competition not found.");
    if (competition.type === "friendly") return c.json([]);
    const result = await c.env.DB.prepare("SELECT * FROM matches WHERE competition_id=? AND status='finished'").bind(competition.id).all<MatchRow>();
    const teamIds = [...new Set(result.results.flatMap((match) => [match.home_team_id, match.away_team_id]))];
    if (!teamIds.length) return c.json([]);
    const teams = await c.env.DB.prepare(`SELECT * FROM teams WHERE id IN (${teamIds.map(() => "?").join(",")})`).bind(...teamIds).all<TeamRow>(); const teamMap = new Map(teams.results.map((team) => [team.id, team]));
    const rows = new Map<string, StandingAccumulator>();
    for (const id of teamIds) rows.set(id, { played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points: 0 });
    for (const match of result.results) { applyStanding(rows.get(match.home_team_id)!, match.home_score, match.away_score); applyStanding(rows.get(match.away_team_id)!, match.away_score, match.home_score); }
    const sorted = [...rows.entries()].sort(([aId, a], [bId, b]) => b.points-a.points || (b.goals_for-b.goals_against)-(a.goals_for-a.goals_against) || b.goals_for-a.goals_for || (teamMap.get(aId)?.name ?? "").localeCompare(teamMap.get(bId)?.name ?? ""));
    return c.json(sorted.map(([id, row], index) => ({ rank: index+1, team: publicTeam(teamMap.get(id) ?? null), ...row, goal_difference: row.goals_for-row.goals_against })));
  });

  app.get("/api/v1/stats/leaders", async (c) => {
    const params = new URL(c.req.url).searchParams;
    const metric = params.get("metric") === "assists" ? "assists" : "goals";
    const ageGroup = params.get("age_group"); const season = params.get("season");
    const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "20", 10) || 20, 1), 100);
    const values: unknown[] = []; const filters: string[] = [];
    const seasonJoin = season ? " JOIN competitions cp ON cp.id=m.competition_id" : "";
    if (ageGroup) { filters.push("t.age_group=?"); values.push(ageGroup); }
    if (season) { filters.push("cp.season=?"); values.push(season); }
    const where = filters.length ? ` AND ${filters.join(" AND ")}` : "";
    const totals = await c.env.DB.prepare(`SELECT s.player_id AS player_id, SUM(s.goals) AS goals, SUM(s.assists) AS assists, SUM(CASE WHEN s.appeared THEN 1 ELSE 0 END) AS appearances FROM player_match_stats s JOIN matches m ON m.id=s.match_id JOIN players p ON p.id=s.player_id JOIN teams t ON t.id=p.team_id${seasonJoin} WHERE m.status='finished'${where} GROUP BY s.player_id`).bind(...values).all<LeaderTotals>();
    const scored = (row: LeaderTotals) => (metric === "goals" ? row.goals : row.assists);
    const counted = totals.results.filter((row) => scored(row) > 0);
    if (!counted.length) return c.json([]);
    const playerIds = counted.map((row) => row.player_id);
    const players = await c.env.DB.prepare(`SELECT * FROM players WHERE id IN (${playerIds.map(() => "?").join(",")})`).bind(...playerIds).all<PlayerRow>();
    const playerMap = new Map(players.results.map((player) => [player.id, player]));
    const teamIds = [...new Set(players.results.map((player) => player.team_id))];
    const teams = await c.env.DB.prepare(`SELECT * FROM teams WHERE id IN (${teamIds.map(() => "?").join(",")})`).bind(...teamIds).all<TeamRow>();
    const teamMap = new Map(teams.results.map((team) => [team.id, team]));
    const ranked = counted.sort((a, b) => scored(b) - scored(a)
      || (metric === "goals" ? b.assists - a.assists : b.goals - a.goals)
      || a.appearances - b.appearances
      || (playerMap.get(a.player_id)?.name ?? "").localeCompare(playerMap.get(b.player_id)?.name ?? "")).slice(0, limit);
    return c.json(ranked.map((row, index) => ({ rank: index + 1, player: publicPlayer(playerMap.get(row.player_id) ?? null), team: publicTeam(teamMap.get(playerMap.get(row.player_id)?.team_id ?? "") ?? null), goals: row.goals, assists: row.assists, appearances: row.appearances })));
  });

  app.get("/api/v1/players/:id/stats", async (c) => {
    const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(c.req.param("id")).first<PlayerRow>(); if (!player) throw new ApiProblem(404, "player_not_found", "Player not found.");
    const season = new URL(c.req.url).searchParams.get("season"); const values: unknown[] = [player.id]; const where = season ? " AND cp.season=?" : ""; if (season) values.push(season);
    const result = await c.env.DB.prepare(`SELECT s.* FROM player_match_stats s JOIN matches m ON m.id=s.match_id JOIN competitions cp ON cp.id=m.competition_id WHERE s.player_id=?${where} ORDER BY m.kickoff_datetime DESC`).bind(...values).all<StatRow>();
    const totals = result.results.reduce((sum, stat) => ({ appearances: sum.appearances + (stat.appeared ? 1 : 0), minutes_played: sum.minutes_played+stat.minutes_played, goals: sum.goals+stat.goals, assists: sum.assists+stat.assists, yellow_cards: sum.yellow_cards+stat.yellow_cards, red_cards: sum.red_cards+stat.red_cards }), { appearances:0, minutes_played:0, goals:0, assists:0, yellow_cards:0, red_cards:0 });
    return c.json({ player: publicPlayer(player), season, ...totals, matches: result.results.map(publicStat) });
  });
}

function eventCounter(type: EventRow["type"]): "goals" | "assists" | "yellow_cards" | "red_cards" | null {
  return ({ goal: "goals", assist: "assists", yellow_card: "yellow_cards", red_card: "red_cards", substitution: null } as const)[type];
}

function scoreRecalculation(env: Env, matchId: string, updated: string): D1PreparedStatement {
  return env.DB.prepare(`UPDATE matches SET home_score=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=matches.id AND e.type='goal' AND e.team_id=matches.home_team_id), away_score=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=matches.id AND e.type='goal' AND e.team_id=matches.away_team_id), revision=revision+1, updated_at=? WHERE id=?`).bind(updated, matchId);
}

function statRecalculation(env: Env, matchId: string, updated: string): D1PreparedStatement {
  return env.DB.prepare(`UPDATE player_match_stats SET goals=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.player_id=player_match_stats.player_id AND e.type='goal'), assists=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.player_id=player_match_stats.player_id AND e.type='assist'), yellow_cards=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.player_id=player_match_stats.player_id AND e.type='yellow_card'), red_cards=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.player_id=player_match_stats.player_id AND e.type='red_card'), updated_at=? WHERE match_id=?`).bind(updated, matchId);
}

async function requirePlayerOnTeam(env: Env, playerId: string, teamId: string): Promise<void> {
  if (!(await env.DB.prepare("SELECT id FROM players WHERE id=? AND team_id=?").bind(playerId, teamId).first())) throw new ApiProblem(422, "invalid_player", "Choose a player from the selected team.");
}

function optionalNullableText(body: Record<string, unknown>, field: string, current: string | null, max: number): string | null { if (!(field in body)) return current; return stringField(body, field, { nullable: true, max }) ?? null; }

interface LeaderTotals { player_id: string; goals: number; assists: number; appearances: number }

interface StandingAccumulator { played:number; won:number; drawn:number; lost:number; goals_for:number; goals_against:number; points:number }
function applyStanding(row: StandingAccumulator, scored: number, conceded: number): void { row.played += 1; row.goals_for += scored; row.goals_against += conceded; if (scored > conceded) { row.won += 1; row.points += 3; } else if (scored === conceded) { row.drawn += 1; row.points += 1; } else row.lost += 1; }
