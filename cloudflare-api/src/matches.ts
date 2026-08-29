import type { Hono } from "hono";
import { ApiProblem, adminUser, booleanField, enumField, jsonArray, jsonObject, nowIso, numberField, publicPlayer, publicStat, publicTeam, stringField } from "./helpers";
import { computeGoalkeeperStats, playersWhoTookTheField } from "./goalkeeping";
import { recordAudit } from "./audit";
import { describeEvent, eventCounter, isOpponentOnly, LOGGABLE_EVENTS, PENALTY_OUTCOMES, SUBSTITUTION_REASONS } from "./scoring-rules";
import { getJoinedMatch, joinedMatch } from "./domain";
import { MatchPhaseTransitionError, transitionMatchPhase } from "./match-clock";
import { POSITION_CODES } from "./positions";
import type { CompetitionRow, EventRow, LineupRow, MatchRow, PlayerRow, StatRow, TeamRow } from "./types";

type App = Hono<{ Bindings: Env }>;

function publicEvent(event: EventRow): Record<string, unknown> {
  return { ...event, is_penalty: Boolean(event.is_penalty) };
}

function publicLineup(entry: LineupRow): Record<string, unknown> {
  return { ...entry, is_starter: Boolean(entry.is_starter), is_captain: Boolean(entry.is_captain) };
}

/**
 * Refuses the sideline surface on a match nobody from AIMZ attends.
 *
 * Hiding the buttons is not the boundary: a match between two opponent clubs
 * has no timeline, no team sheet and no clock to run, so every write that
 * assumes someone is watching is turned away here rather than left to write a
 * half-recorded match. The final score goes in through /result instead.
 */
function requireScorable(match: { home_is_aimz: number; away_is_aimz: number }): void {
  if (isOpponentOnly(match.home_is_aimz, match.away_is_aimz)) {
    throw new ApiProblem(409, "opponent_only_match", "This match is between two opponent teams. Enter the final score instead.");
  }
}

/**
 * Whether this player took the field in this match.
 *
 * The team sheet is the record of who played, so it is asked first: a starter
 * has appeared whether or not she scored, was booked, or had minutes typed in
 * afterwards. `player_match_stats.appeared` is the second question rather than
 * the first, because it is only written when minutes are saved by hand, when an
 * event names the player, or when goalkeeping is worked out — so on its own it
 * misses anyone who simply played an ordinary match, and it was the whole
 * reason a quiet starter could not be given man of the match.
 *
 * Both are consulted: a match scored without a team sheet at all still has the
 * saved minutes to go on.
 */
async function appearedInMatch(env: Env, matchId: string, playerId: string): Promise<boolean> {
  const [lineup, events, recorded] = await Promise.all([
    env.DB.prepare("SELECT * FROM match_lineup_entries WHERE match_id=?").bind(matchId).all<LineupRow>(),
    env.DB.prepare("SELECT * FROM match_events WHERE match_id=?").bind(matchId).all<EventRow>(),
    env.DB.prepare("SELECT id FROM player_match_stats WHERE match_id=? AND player_id=? AND appeared=1").bind(matchId, playerId).first(),
  ]);
  return playersWhoTookTheField(lineup.results, events.results).has(playerId) || Boolean(recorded);
}

/**
 * Which squad each player turned out for in one match.
 *
 * The lineup is the record of it, and answers first. Anyone with a statistic
 * but no lineup entry — minutes saved for a match nobody entered a team sheet
 * for — falls back to the squad they are on now, which is the best available
 * answer at the moment it is written, and is then fixed for good.
 */
export async function squadsForMatch(env: Env, matchId: string): Promise<Map<string, string>> {
  const [lineup, players] = await Promise.all([
    env.DB.prepare("SELECT player_id, team_id FROM match_lineup_entries WHERE match_id = ?").bind(matchId).all<{ player_id: string; team_id: string }>(),
    env.DB.prepare("SELECT p.id, p.team_id FROM players p JOIN matches m ON m.id = ? WHERE p.team_id IN (m.home_team_id, m.away_team_id)").bind(matchId).all<{ id: string; team_id: string }>(),
  ]);
  const squads = new Map(players.results.map((row) => [row.id, row.team_id]));
  for (const row of lineup.results) squads.set(row.player_id, row.team_id);
  return squads;
}

export function registerMatchRoutes(app: App): void {
  app.post("/api/v1/matches/:id/phase", async (c) => {
    const admin = await adminUser(c);
    const match = await getJoinedMatch(c.env, c.req.param("id"));
    requireScorable(match);
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
    // A clean sheet is only settled at full time, so the tallies are rewritten
    // when the whistle goes.
    await c.env.DB.batch(await goalkeeperStatements(c.env, match.id, clock.status === "finished", updated));
    return c.json(joinedMatch(await getJoinedMatch(c.env, match.id)));
  });

  /**
   * The whole scoring surface for a match between two opponent clubs.
   *
   * Everywhere else a scoreline is derived from the timeline and never written
   * by hand, because the timeline is the record. Here there is no timeline to
   * derive it from, so the score is the record, and this is the only route that
   * may set it. Kept off PATCH deliberately: PATCH is what the lineup screen
   * uses to save a formation, and widening it would let a score be typed over
   * an AIMZ match that events had already counted.
   *
   * It goes straight to finished without asking the clock, since scheduled to
   * finished is a transition the phase machine has no reason to allow. Calling
   * it again on a finished match is how a wrong score is corrected.
   */
  app.post("/api/v1/matches/:id/result", async (c) => {
    const admin = await adminUser(c);
    const match = await getJoinedMatch(c.env, c.req.param("id"));
    if (!isOpponentOnly(match.home_is_aimz, match.away_is_aimz)) {
      throw new ApiProblem(409, "not_opponent_only", "This match has an AIMZ squad in it. Score it from live scoring.");
    }
    const body = await jsonObject(c);
    const homeScore = numberField(body, "home_score", { min: 0, max: 99, integer: true })!;
    const awayScore = numberField(body, "away_score", { min: 0, max: 99, integer: true })!;
    const updated = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE matches SET home_score=?, away_score=?, status='finished', phase='finished', phase_started_at=NULL, revision=revision+1, updated_at=? WHERE id=?").bind(homeScore, awayScore, updated, match.id),
      recordAudit(c.env, admin, { action: "result_entered", entityType: "match", entityId: match.id, matchId: match.id, summary: `${match.status === "finished" ? "Corrected the final score to" : "Recorded a final score of"} ${homeScore}-${awayScore}.` }),
    ]);
    return c.json(joinedMatch(await getJoinedMatch(c.env, match.id)));
  });

  app.post("/api/v1/matches/:id/man-of-the-match", async (c) => {
    const admin = await adminUser(c);
    const match = await getJoinedMatch(c.env, c.req.param("id"));
    requireScorable(match);
    if (match.status !== "finished") throw new ApiProblem(409, "match_not_finished", "Pick man of the match once the match has finished.");
    const body = await jsonObject(c);
    const playerId = stringField(body, "player_id", { optional: true, nullable: true, max: 36 }) ?? null;
    // An opponent has no player record here, so the award can name their side
    // instead. The two are exclusive: one award, one winner.
    const isOpponent = booleanField(body, "is_opponent", false) && !playerId;
    let name = isOpponent ? "An opponent player" : "No one";
    if (playerId) {
      const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(playerId).first<PlayerRow>();
      if (!player || (player.team_id !== match.home_team_id && player.team_id !== match.away_team_id)) throw new ApiProblem(422, "invalid_award_player", "That player did not play in this match.");
      if (!(await appearedInMatch(c.env, match.id, playerId))) throw new ApiProblem(422, "player_did_not_appear", "Only a player who appeared can take the award.");
      name = player.name;
    }
    const updated = nowIso();
    await c.env.DB.batch([
      // The live snapshot is cached on the revision, so it has to move or a
      // stale ETag would hide the award.
      c.env.DB.prepare("UPDATE matches SET man_of_the_match_player_id=?, man_of_the_match_is_opponent=?, revision=revision+1, updated_at=? WHERE id=?").bind(playerId, isOpponent ? 1 : 0, updated, match.id),
      recordAudit(c.env, admin, { action: "man_of_the_match_set", entityType: "match", entityId: match.id, matchId: match.id, summary: playerId || isOpponent ? `Named ${name} man of the match.` : "Cleared man of the match." }),
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
    requireScorable(match);
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
    try {
      await c.env.DB.batch(statements);
      // Read after the write: the keeper's tally is worked out from the timeline
      // this event has just joined.
      await c.env.DB.batch(await goalkeeperStatements(c.env, match.id, match.status === "finished", now));
    }
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
    requireScorable(match);
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
    await c.env.DB.batch(await goalkeeperStatements(c.env, match.id, match.status === "finished", event.updated_at));
    return c.json(publicEvent(event));
  });

  app.delete("/api/v1/matches/:matchId/events/:eventId", async (c) => {
    const admin = await adminUser(c);
    const match = await getJoinedMatch(c.env, c.req.param("matchId"));
    requireScorable(match);
    const exists = await c.env.DB.prepare("SELECT id FROM match_events WHERE id = ? AND match_id = ?").bind(c.req.param("eventId"), match.id).first();
    if (!exists) throw new ApiProblem(404, "event_not_found", "Match event not found.");
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM match_events WHERE id = ? AND match_id = ?").bind(c.req.param("eventId"), match.id),
      scoreRecalculation(c.env, match.id, now),
      statRecalculation(c.env, match.id, now),
      recordAudit(c.env, admin, { action: "event_removed", entityType: "match_event", entityId: c.req.param("eventId"), matchId: match.id, summary: "Removed an event from the timeline." }),
    ]);
    await c.env.DB.batch(await goalkeeperStatements(c.env, match.id, match.status === "finished", now));
    return c.body(null, 204);
  });

  app.put("/api/v1/matches/:id/lineup", async (c) => {
    const admin = await adminUser(c); const match = await getJoinedMatch(c.env, c.req.param("id"));
    requireScorable(match);
    // Once under way, who is on the pitch changes through substitutions.
    if (match.status !== "scheduled") throw new ApiProblem(409, "lineup_locked", "The lineup is locked once the match starts. Log a substitution instead."); const body = await jsonArray(c); const statements = [c.env.DB.prepare("DELETE FROM match_lineup_entries WHERE match_id = ?").bind(match.id)]; const output: LineupRow[] = [];
    for (const item of body) {
      const playerId = stringField(item, "player_id", { min: 1, max: 36 })!; const teamId = stringField(item, "team_id", { min: 1, max: 36 })!;
      if (teamId !== match.home_team_id && teamId !== match.away_team_id) throw new ApiProblem(422, "invalid_team", "Every lineup team must be part of this match.");
      await requirePlayerOnTeam(c.env, playerId, teamId);
      const row: LineupRow = { id: crypto.randomUUID(), match_id: match.id, player_id: playerId, team_id: teamId, is_starter: booleanField(item, "is_starter", false) ? 1 : 0, is_captain: booleanField(item, "is_captain", false) ? 1 : 0, position: item.position == null ? null : enumField(item, "position", POSITION_CODES), jersey_number: numberField(item, "jersey_number", { optional: true, nullable: true, min: 0, max: 99 }) ?? null };
      output.push(row); statements.push(c.env.DB.prepare("INSERT INTO match_lineup_entries (id, match_id, player_id, team_id, is_starter, is_captain, position, jersey_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(row.id, row.match_id, row.player_id, row.team_id, row.is_starter, row.is_captain, row.position, row.jersey_number));
    }
    statements.push(c.env.DB.prepare("UPDATE matches SET revision=revision+1, updated_at=? WHERE id=?").bind(nowIso(), match.id));
    statements.push(recordAudit(c.env, admin, { action: "lineup_saved", entityType: "lineup", entityId: match.id, matchId: match.id, summary: `Saved a lineup with ${output.filter((row) => row.is_starter).length} starters.` }));
    await c.env.DB.batch(statements); return c.json(output.map(publicLineup));
  });

  app.put("/api/v1/matches/:id/player-stats", async (c) => {
    const admin = await adminUser(c); const match = await getJoinedMatch(c.env, c.req.param("id")); requireScorable(match); const body = await jsonArray(c); const now = nowIso(); const statements = []; const playerIds: string[] = [];
    // Which squad each player turned out for, taken from the lineup and falling
    // back to the squad she is on now. Stamped on the statistic so a promotion
    // to an older age group never carries this match's record with her.
    const squadOf = await squadsForMatch(c.env, match.id);
    for (const item of body) {
      const playerId = stringField(item, "player_id", { min: 1, max: 36 })!; playerIds.push(playerId);
      const appeared = booleanField(item, "appeared") ? 1 : 0; const minutes = numberField(item, "minutes_played", { min: 0, max: 150 })!;
      const teamId = squadOf.get(playerId) ?? null;
      statements.push(c.env.DB.prepare(`INSERT INTO player_match_stats (id, match_id, player_id, team_id, appeared, minutes_played, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(match_id, player_id) DO UPDATE SET team_id=excluded.team_id, appeared=excluded.appeared, minutes_played=excluded.minutes_played, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), match.id, playerId, teamId, appeared, minutes, now, now));
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

/**
 * Write the goalkeeping tallies for a match.
 *
 * Unlike the outfield counters, these cannot be a single UPDATE: who conceded a
 * goal depends on which keeper was on the pitch at the minute, which is a walk
 * through the substitutions rather than something SQL can count in place. So
 * the timeline is read, the answer is worked out, and the rows are written.
 */
async function goalkeeperStatements(env: Env, matchId: string, finished: boolean, updated: string): Promise<D1PreparedStatement[]> {
  const [lineup, events] = await Promise.all([
    env.DB.prepare("SELECT * FROM match_lineup_entries WHERE match_id=?").bind(matchId).all<LineupRow>(),
    env.DB.prepare("SELECT * FROM match_events WHERE match_id=?").bind(matchId).all<EventRow>(),
  ]);
  const stats = computeGoalkeeperStats(lineup.results, events.results, finished);
  // Everyone is cleared first, so a keeper who is corrected off the sheet, or
  // moved out of goal, does not keep a tally they are no longer owed.
  const statements = [env.DB.prepare("UPDATE player_match_stats SET goals_conceded=0, penalties_saved=0, clean_sheet=0, updated_at=? WHERE match_id=?").bind(updated, matchId)];
  for (const [playerId, row] of stats) {
    statements.push(env.DB.prepare(`
      INSERT INTO player_match_stats (id, match_id, player_id, appeared, minutes_played, goals_conceded, penalties_saved, clean_sheet, created_at, updated_at)
      VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, ?)
      ON CONFLICT(match_id, player_id) DO UPDATE SET goals_conceded=excluded.goals_conceded, penalties_saved=excluded.penalties_saved, clean_sheet=excluded.clean_sheet, appeared=1, updated_at=excluded.updated_at
    `).bind(crypto.randomUUID(), matchId, playerId, row.goals_conceded, row.penalties_saved, row.clean_sheet, updated, updated));
  }
  return statements;
}

function statRecalculation(env: Env, matchId: string, updated: string): D1PreparedStatement {
  return env.DB.prepare(`UPDATE player_match_stats SET goals=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.player_id=player_match_stats.player_id AND e.type='goal'), assists=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.secondary_player_id=player_match_stats.player_id AND e.type='goal'), own_goals=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.player_id=player_match_stats.player_id AND e.type='own_goal'), yellow_cards=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.player_id=player_match_stats.player_id AND e.type='yellow_card'), red_cards=(SELECT COUNT(*) FROM match_events e WHERE e.match_id=player_match_stats.match_id AND e.player_id=player_match_stats.player_id AND e.type='red_card'), updated_at=? WHERE match_id=?`).bind(updated, matchId);
}

async function requirePlayerOnTeam(env: Env, playerId: string, teamId: string): Promise<void> {
  if (!(await env.DB.prepare("SELECT id FROM players WHERE id=? AND team_id=?").bind(playerId, teamId).first())) throw new ApiProblem(422, "invalid_player", "Choose a player from the selected team.");
}

function optionalNullableText(body: Record<string, unknown>, field: string, current: string | null, max: number): string | null { if (!(field in body)) return current; return stringField(body, field, { nullable: true, max }) ?? null; }
