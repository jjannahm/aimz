import type { Hono } from "hono";
import { ApiProblem, adminUser, booleanField, enumField, jsonArray, jsonObject, nowIso, numberField, publicPlayer, publicStat, publicTeam, stringField } from "./helpers";
import { recordAudit } from "./audit";
import { describeEvent, eventCounter, LOGGABLE_EVENTS, PENALTY_OUTCOMES, SUBSTITUTION_REASONS } from "./scoring-rules";
import { getJoinedMatch, joinedMatch } from "./domain";
import { MatchPhaseTransitionError, transitionMatchPhase } from "./match-clock";
import type { CompetitionRow, EventRow, LineupRow, MatchRow, PlayerRow, StatRow, TeamRow } from "./types";

type App = Hono<{ Bindings: Env }>;

function publicEvent(event: EventRow): Record<string, unknown> {
  return { ...event, is_penalty: Boolean(event.is_penalty) };
}

function publicLineup(entry: LineupRow): Record<string, unknown> {
  return { ...entry, is_starter: Boolean(entry.is_starter), is_captain: Boolean(entry.is_captain) };
}

export function registerMatchRoutes(app: App): void {
  app.post("/api/v1/matches/:id/phase", async (c) => {
    const admin = await adminUser(c);
    const match = await getJoinedMatch(c.env, c.req.param("id"));
    const body = await jsonObject(c);
    const action = enumField(body, "action", ["start_match", "halftime", "start_second_half", "start_extra_time", "finish_match"] as const);
    const updated = nowIso();
    let clock;
    try { clock = transitionMatchPhase(match, action, updated); }
    catch (error) {
      if (error instanceof MatchPhaseTransitionError) throw new ApiProblem(409, error.code, error.message);
      throw error;
    }
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE matches SET status=?, phase=?, phase_started_at=?, revision=revision+1, updated_at=? WHERE id=?").bind(clock.status, clock.phase, clock.phase_started_at, updated, match.id),
      recordAudit(c.env, admin, { action, entityType: "match", entityId: match.id, matchId: match.id, summary: `Match clock moved to ${clock.phase.replace(/_/gu, " ")}.` }),
    ]);
    return c.json(joinedMatch(await getJoinedMatch(c.env, match.id)));
  });

  app.post("/api/v1/matches/:id/man-of-the-match", async (c) => {
    const admin = await adminUser(c);
    const match = await getJoinedMatch(c.env, c.req.param("id"));
    if (match.status !== "finished") throw new ApiProblem(409, "match_not_finished", "Pick man of the match once the match has finished.");
    const body = await jsonObject(c);
    const playerId = stringField(body, "player_id", { optional: true, nullable: true, max: 36 }) ?? null;
    let name = "No one";
    if (playerId) {
      const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(playerId).first<PlayerRow>();
      if (!player || (player.team_id !== match.home_team_id && player.team_id !== match.away_team_id)) throw new ApiProblem(422, "invalid_award_player", "That player did not play in this match.");
      const appeared = await c.env.DB.prepare("SELECT id FROM player_match_stats WHERE match_id=? AND player_id=? AND appeared=1").bind(match.id, playerId).first();
      if (!appeared) throw new ApiProblem(422, "player_did_not_appear", "Only a player who appeared can take the award.");
      name = player.name;
    }
    const updated = nowIso();
    await c.env.DB.batch([
      // The live snapshot is cached on the revision, so it has to move or a
      // stale ETag would hide the award.
      c.env.DB.prepare("UPDATE matches SET man_of_the_match_player_id=?, revision=revision+1, updated_at=? WHERE id=?").bind(playerId, updated, match.id),
      recordAudit(c.env, admin, { action: "man_of_the_match_set", entityType: "match", entityId: match.id, matchId: match.id, summary: playerId ? `Named ${name} man of the match.` : "Cleared man of the match." }),
    ]);
    return c.json(joinedMatch(await getJoinedMatch(c.env, match.id)));
  });

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
    const admin = await adminUser(c);
    const match = await getJoinedMatch(c.env, c.req.param("id"));
    const body = await jsonObject(c);
    const operationId = stringField(body, "client_operation_id", { min: 8, max: 64 })!;
    const duplicate = await c.env.DB.prepare("SELECT * FROM match_events WHERE client_operation_id = ?").bind(operationId).first<EventRow>();
    if (duplicate) return c.json(publicEvent(duplicate));

    const type = enumField(body, "type", LOGGABLE_EVENTS);
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
      substitution_reason: body.substitution_reason == null ? null : enumField(body, "substitution_reason", SUBSTITUTION_REASONS),
      penalty_outcome: body.penalty_outcome == null ? null : enumField(body, "penalty_outcome", PENALTY_OUTCOMES),
      client_operation_id: operationId, created_at: now, updated_at: now,
    };

    const statements = [
      c.env.DB.prepare("INSERT INTO match_events (id, match_id, type, minute, team_id, player_id, secondary_player_id, related_event_id, notes, is_penalty, substitution_reason, penalty_outcome, client_operation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(event.id, event.match_id, event.type, event.minute, event.team_id, event.player_id, event.secondary_player_id, event.related_event_id, event.notes, event.is_penalty, event.substitution_reason, event.penalty_outcome, event.client_operation_id, now, now),
    ];
    // A goal carries its own assist, so the provider is credited from the same row.
    if (type === "goal" && event.secondary_player_id) {
      statements.push(c.env.DB.prepare(`
        INSERT INTO player_match_stats (id, match_id, player_id, appeared, minutes_played, goals, assists, own_goals, yellow_cards, red_cards, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, 0, 1, 0, 0, 0, ?, ?)
        ON CONFLICT(match_id, player_id) DO UPDATE SET assists = assists + 1, appeared = 1, updated_at = excluded.updated_at
      `).bind(crypto.randomUUID(), match.id, event.secondary_player_id, now, now));
    }
    const counter = eventCounter(type);
    if (playerId && counter) {
      statements.push(c.env.DB.prepare(`
        INSERT INTO player_match_stats (id, match_id, player_id, appeared, minutes_played, goals, assists, own_goals, yellow_cards, red_cards, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(match_id, player_id) DO UPDATE SET ${counter} = ${counter} + 1, appeared = 1, updated_at = excluded.updated_at
      `).bind(crypto.randomUUID(), match.id, playerId, type === "goal" ? 1 : 0, 0, type === "own_goal" ? 1 : 0, type === "yellow_card" ? 1 : 0, type === "red_card" ? 1 : 0, now, now));
    }
    statements.push(scoreRecalculation(c.env, match.id, now));
    statements.push(recordAudit(c.env, admin, { action: "event_added", entityType: "match_event", entityId: event.id, matchId: match.id, summary: `Added ${describeEvent(event)}.` }));
    try { await c.env.DB.batch(statements); }
    catch (error) {
      const existing = await c.env.DB.prepare("SELECT * FROM match_events WHERE client_operation_id = ?").bind(operationId).first<EventRow>();
      if (existing) return c.json(publicEvent(existing));
      throw error;
    }
    return c.json(publicEvent(event), 201);
  });

  app.patch("/api/v1/matches/:matchId/events/:eventId", async (c) => {
    const admin = await adminUser(c);
    const match = await getJoinedMatch(c.env, c.req.param("matchId"));
    const current = await c.env.DB.prepare("SELECT * FROM match_events WHERE id = ? AND match_id = ?").bind(c.req.param("eventId"), match.id).first<EventRow>();
    if (!current) throw new ApiProblem(404, "event_not_found", "Match event not found.");
    const body = await jsonObject(c);
    const type = body.type === undefined ? current.type : enumField(body, "type", LOGGABLE_EVENTS);
    const teamId = stringField(body, "team_id", { optional: true, min: 1, max: 36 }) ?? current.team_id;
    if (teamId !== match.home_team_id && teamId !== match.away_team_id) throw new ApiProblem(422, "invalid_team", "The event team must be part of this match.");
    const event: EventRow = {
      ...current, type, team_id: teamId,
      minute: body.minute === undefined ? current.minute : numberField(body, "minute", { nullable: true, min: 0, max: 150 }) ?? null,
      player_id: optionalNullableText(body, "player_id", current.player_id, 36),
      secondary_player_id: optionalNullableText(body, "secondary_player_id", current.secondary_player_id, 36),
      notes: optionalNullableText(body, "notes", current.notes, 1000),
      substitution_reason: body.substitution_reason === undefined ? current.substitution_reason : body.substitution_reason == null ? null : enumField(body, "substitution_reason", SUBSTITUTION_REASONS),
      penalty_outcome: body.penalty_outcome === undefined ? current.penalty_outcome : body.penalty_outcome == null ? null : enumField(body, "penalty_outcome", PENALTY_OUTCOMES),
      updated_at: nowIso(),
    };
    if (event.player_id) await requirePlayerOnTeam(c.env, event.player_id, teamId);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE match_events SET type=?, minute=?, team_id=?, player_id=?, secondary_player_id=?, notes=?, substitution_reason=?, penalty_outcome=?, updated_at=? WHERE id=?").bind(event.type, event.minute, event.team_id, event.player_id, event.secondary_player_id, event.notes, event.substitution_reason, event.penalty_outcome, event.updated_at, event.id),
      scoreRecalculation(c.env, match.id, event.updated_at),
      statRecalculation(c.env, match.id, event.updated_at),
      recordAudit(c.env, admin, { action: "event_corrected", entityType: "match_event", entityId: event.id, matchId: match.id, summary: `Corrected ${describeEvent(event)}.` }),
    ]);
    return c.json(publicEvent(event));
  });

  app.delete("/api/v1/matches/:matchId/events/:eventId", async (c) => {
    const admin = await adminUser(c);
    const match = await getJoinedMatch(c.env, c.req.param("matchId"));
    const exists = await c.env.DB.prepare("SELECT id FROM match_events WHERE id = ? AND match_id = ?").bind(c.req.param("eventId"), match.id).first();
    if (!exists) throw new ApiProblem(404, "event_not_found", "Match event not found.");
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM match_events WHERE id = ? AND match_id = ?").bind(c.req.param("eventId"), match.id),
      scoreRecalculation(c.env, match.id, now),
      statRecalculation(c.env, match.id, now),
      recordAudit(c.env, admin, { action: "event_removed", entityType: "match_event", entityId: c.req.param("eventId"), matchId: match.id, summary: "Removed an event from the timeline." }),
    ]);
    return c.body(null, 204);
  });

  app.put("/api/v1/matches/:id/lineup", async (c) => {
    const admin = await adminUser(c); const match = await getJoinedMatch(c.env, c.req.param("id"));
    // Once under way, who is on the pitch changes through substitutions.
    if (match.status !== "scheduled") throw new ApiProblem(409, "lineup_locked", "The lineup is locked once the match starts. Log a substitution instead."); const body = await jsonArray(c); const statements = [c.env.DB.prepare("DELETE FROM match_lineup_entries WHERE match_id = ?").bind(match.id)]; const output: LineupRow[] = [];
    for (const item of body) {
      const playerId = stringField(item, "player_id", { min: 1, max: 36 })!; const teamId = stringField(item, "team_id", { min: 1, max: 36 })!;
      if (teamId !== match.home_team_id && teamId !== match.away_team_id) throw new ApiProblem(422, "invalid_team", "Every lineup team must be part of this match.");
      await requirePlayerOnTeam(c.env, playerId, teamId);
      const row: LineupRow = { id: crypto.randomUUID(), match_id: match.id, player_id: playerId, team_id: teamId, is_starter: booleanField(item, "is_starter", false) ? 1 : 0, is_captain: booleanField(item, "is_captain", false) ? 1 : 0, position: stringField(item, "position", { optional: true, nullable: true, max: 60 }) ?? null, jersey_number: numberField(item, "jersey_number", { optional: true, nullable: true, min: 0, max: 99 }) ?? null };
      output.push(row); statements.push(c.env.DB.prepare("INSERT INTO match_lineup_entries (id, match_id, player_id, team_id, is_starter, is_captain, position, jersey_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(row.id, row.match_id, row.player_id, row.team_id, row.is_starter, row.is_captain, row.position, row.jersey_number));
    }
    statements.push(c.env.DB.prepare("UPDATE matches SET revision=revision+1, updated_at=? WHERE id=?").bind(nowIso(), match.id));
    statements.push(recordAudit(c.env, admin, { action: "lineup_saved", entityType: "lineup", entityId: match.id, matchId: match.id, summary: `Saved a lineup with ${output.filter((row) => row.is_starter).length} starters.` }));
    await c.env.DB.batch(statements); return c.json(output.map(publicLineup));
  });

  app.put("/api/v1/matches/:id/player-stats", async (c) => {
    const admin = await adminUser(c); const match = await getJoinedMatch(c.env, c.req.param("id")); const body = await jsonArray(c); const now = nowIso(); const statements = []; const playerIds: string[] = [];
    for (const item of body) {
      const playerId = stringField(item, "player_id", { min: 1, max: 36 })!; playerIds.push(playerId);
      const appeared = booleanField(item, "appeared") ? 1 : 0; const minutes = numberField(item, "minutes_played", { min: 0, max: 150 })!;
      statements.push(c.env.DB.prepare(`INSERT INTO player_match_stats (id, match_id, player_id, appeared, minutes_played, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(match_id, player_id) DO UPDATE SET appeared=excluded.appeared, minutes_played=excluded.minutes_played, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), match.id, playerId, appeared, minutes, now, now));
    }
    statements.push(c.env.DB.prepare("UPDATE matches SET revision=revision+1, updated_at=? WHERE id=?").bind(now, match.id));
    statements.push(recordAudit(c.env, admin, { action: "minutes_saved", entityType: "player_stats", entityId: match.id, matchId: match.id, summary: `Saved minutes for ${playerIds.length} players.` }));
    await c.env.DB.batch(statements);
    if (!playerIds.length) return c.json([]);
    const placeholders = playerIds.map(() => "?").join(","); const result = await c.env.DB.prepare(`SELECT * FROM player_match_stats WHERE match_id=? AND player_id IN (${placeholders})`).bind(match.id, ...playerIds).all<StatRow>(); return c.json(result.results.map(publicStat));
  });

  app.get("/api/v1/matches/:id/player-stats", async (c) => {
    await getJoinedMatch(c.env, c.req.param("id")); const result = await c.env.DB.prepare("SELECT * FROM player_match_stats WHERE match_id=? ORDER BY player_id").bind(c.req.param("id")).all<StatRow>(); return c.json(result.results.map(publicStat));
  });

}


function scoreRecalculation(env: Env, matchId: string, updated: string): D1PreparedStatement {
  // An own goal is filed against the team that conceded it, because that is the
  // team the scorer plays for, so it counts on the opponent's scoreline.
  const scored = (team: "home" | "away", other: "home" | "away") =>
    `(SELECT COUNT(*) FROM match_events e WHERE e.match_id=matches.id AND ((e.type='goal' AND e.team_id=matches.${team}_team_id) OR (e.type='own_goal' AND e.team_id=matches.${other}_team_id)))`;
  return env.DB.prepare(`UPDATE matches SET home_score=${scored("home", "away")}, away_score=${scored("away", "home")}, revision=revision+1, updated_at=? WHERE id=?`).bind(updated, matchId);
}

function statRecalculation(env: Env, matchId: string, updated: string): D1PreparedStatement {
  return env.DB.prepare(`UPDATE player_match_stats SET goals=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.player_id=player_match_stats.player_id AND e.type='goal'), assists=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.secondary_player_id=player_match_stats.player_id AND e.type='goal'), own_goals=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.player_id=player_match_stats.player_id AND e.type='own_goal'), yellow_cards=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.player_id=player_match_stats.player_id AND e.type='yellow_card'), red_cards=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.player_id=player_match_stats.player_id AND e.type='red_card'), updated_at=? WHERE match_id=?`).bind(updated, matchId);
}

async function requirePlayerOnTeam(env: Env, playerId: string, teamId: string): Promise<void> {
  if (!(await env.DB.prepare("SELECT id FROM players WHERE id=? AND team_id=?").bind(playerId, teamId).first())) throw new ApiProblem(422, "invalid_player", "Choose a player from the selected team.");
}

function optionalNullableText(body: Record<string, unknown>, field: string, current: string | null, max: number): string | null { if (!(field in body)) return current; return stringField(body, field, { nullable: true, max }) ?? null; }

