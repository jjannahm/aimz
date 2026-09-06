import type { Context, Hono } from "hono";
import { ApiProblem, adminUser, currentUser, enumField, jsonObject, nowIso, numberField, parsePagination, publicPlayer, publicTeam, stringField } from "./helpers";
import { canOpenTeam, requireAimzTeam, scopedTeams } from "./team-access";
import type { AttendanceRow, AvailabilityRow, PlayerRow, TeamRow, TrainingRow, UserRow } from "./types";

type App = Hono<{ Bindings: Env }>;

function validInstant(value: unknown, field = "starts_at"): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new ApiProblem(422, "validation_error", "Check the highlighted fields.", [{ field, message: "Enter a valid date and time." }]);
  return new Date(value).toISOString();
}

async function trainingById(env: Env, id: string): Promise<TrainingRow> {
  const row = await env.DB.prepare("SELECT * FROM training_sessions WHERE id=?").bind(id).first<TrainingRow>();
  if (!row) throw new ApiProblem(404, "training_not_found", "Training session not found.");
  return row;
}

async function trainingTeam(env: Env, teamId: string): Promise<TeamRow> {
  const team = await env.DB.prepare("SELECT * FROM teams WHERE id=?").bind(teamId).first<TeamRow>();
  if (!team) throw new ApiProblem(404, "team_not_found", "Squad not found.");
  return team;
}

function publicTraining(row: TrainingRow, team: TeamRow): Record<string, unknown> {
  return { ...row, team: publicTeam(team) };
}

async function requireTrainingAccess(c: Context<{ Bindings: Env }>, row: TrainingRow, user?: UserRow): Promise<UserRow> {
  const actor = user ?? await currentUser(c);
  if (actor.role === "admin") return actor;
  if (!(await canOpenTeam(c.env, actor, row.team_id))) throw new ApiProblem(403, "team_access_denied", "You can only open your own squad's training sessions.");
  return actor;
}

/**
 * The register for one session: every player on the squad, with how they were
 * marked, or null for anyone not marked yet.
 *
 * The squad comes from the roster rather than from the marks, so a coach
 * opening a session for the first time is handed the whole squad to mark. There
 * is no attendance roster of its own.
 */
async function attendanceFor(env: Env, session: TrainingRow): Promise<Record<string, unknown>> {
  const [squad, marks] = await Promise.all([
    env.DB.prepare("SELECT * FROM players WHERE team_id=? AND is_active=1 ORDER BY name").bind(session.team_id).all<PlayerRow>(),
    env.DB.prepare("SELECT * FROM training_attendance WHERE training_session_id=?").bind(session.id).all<AttendanceRow>(),
  ]);
  const byPlayer = new Map(marks.results.map((row) => [row.player_id, row]));
  const items = squad.results.map((player) => ({
    player: publicPlayer(player),
    status: byPlayer.get(player.id)?.status ?? null,
    marked_at: byPlayer.get(player.id)?.updated_at ?? null,
  }));
  return {
    items,
    present: items.filter((row) => row.status === "present").length,
    absent: items.filter((row) => row.status === "absent").length,
    unmarked: items.filter((row) => row.status === null).length,
  };
}

export function registerTrainingRoutes(app: App): void {
  app.get("/api/v1/training-sessions", async (c) => {
    const url = new URL(c.req.url);
    const requested = url.searchParams.get("team_id");
    const { teamIds: allowedTeamIds } = await scopedTeams(c, requested);
    const { limit, offset } = parsePagination(url);
    const conditions: string[] = [];
    const values: unknown[] = [];
    // A parent sees every squad their children are on, so this is an IN list.
    if (allowedTeamIds) { conditions.push(`team_id IN (${allowedTeamIds.map(() => "?").join(",")})`); values.push(...allowedTeamIds); }
    for (const [parameter, operator] of [["from", ">="], ["to", "<="]] as const) {
      const raw = url.searchParams.get(parameter);
      if (raw) { conditions.push(`starts_at ${operator} ?`); values.push(validInstant(raw, parameter)); }
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const [count, rows] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) total FROM training_sessions${where}`).bind(...values).first<{ total: number }>(),
      c.env.DB.prepare(`SELECT * FROM training_sessions${where} ORDER BY starts_at LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<TrainingRow>(),
    ]);
    const teamIds = [...new Set(rows.results.map((row) => row.team_id))];
    const teams = teamIds.length ? await c.env.DB.prepare(`SELECT * FROM teams WHERE id IN (${teamIds.map(() => "?").join(",")})`).bind(...teamIds).all<TeamRow>() : { results: [] as TeamRow[] };
    const byId = new Map(teams.results.map((team) => [team.id, team]));
    return c.json({ items: rows.results.map((row) => publicTraining(row, byId.get(row.team_id)!)), total: count?.total ?? 0, limit, offset });
  });

  app.get("/api/v1/training-sessions/:id", async (c) => {
    const row = await trainingById(c.env, c.req.param("id"));
    await requireTrainingAccess(c, row);
    return c.json(publicTraining(row, await trainingTeam(c.env, row.team_id)));
  });

  app.post("/api/v1/training-sessions", async (c) => {
    await adminUser(c);
    const body = await jsonObject(c);
    const teamId = stringField(body, "team_id", { min: 1, max: 36 })!;
    await requireAimzTeam(c.env, teamId);
    const venue = stringField(body, "venue", { min: 2, max: 200 })!;
    const notes = stringField(body, "notes", { optional: true, nullable: true, max: 2000 }) ?? null;
    const duration = numberField(body, "duration_minutes", { min: 15, max: 300, integer: true })!;
    if (!Array.isArray(body.occurrences) || body.occurrences.length < 1 || body.occurrences.length > 200) throw new ApiProblem(422, "validation_error", "Add between 1 and 200 training occurrences.", [{ field: "occurrences", message: "Add between 1 and 200 dates." }]);
    const occurrences = [...new Set(body.occurrences.map((value) => validInstant(value, "occurrences")))].sort();
    const seriesId = occurrences.length > 1 ? crypto.randomUUID() : null;
    const now = nowIso();
    const rows = occurrences.map<TrainingRow>((startsAt) => ({ id: crypto.randomUUID(), team_id: teamId, starts_at: startsAt, duration_minutes: duration, venue, notes, series_id: seriesId, created_at: now, updated_at: now }));
    await c.env.DB.batch(rows.map((row) => c.env.DB.prepare("INSERT INTO training_sessions (id, team_id, starts_at, duration_minutes, venue, notes, series_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(row.id, row.team_id, row.starts_at, row.duration_minutes, row.venue, row.notes, row.series_id, now, now)));
    const team = await trainingTeam(c.env, teamId);
    return c.json(rows.map((row) => publicTraining(row, team)), 201);
  });

  app.patch("/api/v1/training-sessions/:id", async (c) => {
    await adminUser(c);
    const current = await trainingById(c.env, c.req.param("id"));
    const body = await jsonObject(c);
    const row: TrainingRow = {
      ...current,
      starts_at: body.starts_at === undefined ? current.starts_at : validInstant(body.starts_at),
      duration_minutes: numberField(body, "duration_minutes", { optional: true, min: 15, max: 300, integer: true }) ?? current.duration_minutes,
      venue: stringField(body, "venue", { optional: true, min: 2, max: 200 }) ?? current.venue,
      notes: body.notes === undefined ? current.notes : stringField(body, "notes", { nullable: true, max: 2000 }) ?? null,
      updated_at: nowIso(),
    };
    await c.env.DB.prepare("UPDATE training_sessions SET starts_at=?, duration_minutes=?, venue=?, notes=?, updated_at=? WHERE id=?").bind(row.starts_at, row.duration_minutes, row.venue, row.notes, row.updated_at, row.id).run();
    return c.json(publicTraining(row, await trainingTeam(c.env, row.team_id)));
  });

  app.delete("/api/v1/training-sessions/:id", async (c) => {
    await adminUser(c);
    const row = await trainingById(c.env, c.req.param("id"));
    const scope = new URL(c.req.url).searchParams.get("scope") ?? "one";
    if (scope !== "one" && scope !== "series") throw new ApiProblem(422, "validation_error", "Delete one session or its whole series.");
    if (scope === "series" && row.series_id) await c.env.DB.prepare("DELETE FROM training_sessions WHERE series_id=?").bind(row.series_id).run();
    else await c.env.DB.prepare("DELETE FROM training_sessions WHERE id=?").bind(row.id).run();
    return c.body(null, 204);
  });

  app.get("/api/v1/training-sessions/:id/availability", async (c) => {
    const session = await trainingById(c.env, c.req.param("id"));
    await requireTrainingAccess(c, session);
    const rows = await c.env.DB.prepare("SELECT * FROM training_availability WHERE training_session_id=? ORDER BY updated_at DESC").bind(session.id).all<AvailabilityRow>();
    const playerIds = rows.results.map((row) => row.player_id);
    const players = playerIds.length ? await c.env.DB.prepare(`SELECT * FROM players WHERE id IN (${playerIds.map(() => "?").join(",")})`).bind(...playerIds).all<PlayerRow>() : { results: [] as PlayerRow[] };
    const byId = new Map(players.results.map((player) => [player.id, player]));
    return c.json(rows.results.map((row) => ({ ...row, player: publicPlayer(byId.get(row.player_id) ?? null) })));
  });

  /**
   * The register for one session: every player on the squad, with how they were
   * marked, or null for anyone not marked yet.
   *
   * The squad is read from the roster rather than from the rows, so a coach
   * opening a session for the first time is handed the whole squad to mark
   * rather than an empty list. There is no separate attendance roster.
   */
  app.get("/api/v1/training-sessions/:id/attendance", async (c) => {
    const session = await trainingById(c.env, c.req.param("id"));
    await requireTrainingAccess(c, session);
    return c.json(await attendanceFor(c.env, session));
  });

  /**
   * Marks players present or absent. Only what is sent is touched, so a coach
   * correcting one name does not clear the rest of the register, and sending
   * null for somebody takes their mark away rather than guessing at it.
   */
  app.put("/api/v1/training-sessions/:id/attendance", async (c) => {
    await adminUser(c);
    const session = await trainingById(c.env, c.req.param("id"));
    const body = await jsonObject(c);
    if (!Array.isArray(body.entries) || body.entries.length > 200) throw new ApiProblem(422, "validation_error", "Send between 1 and 200 attendance marks.", [{ field: "entries", message: "Send up to 200 marks." }]);
    const entries = body.entries.map((raw) => {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const playerId = stringField(entry, "player_id", { min: 1, max: 36 })!;
      const status = entry.status === null || entry.status === undefined ? null : enumField(entry, "status", ["present", "absent"] as const);
      return { playerId, status };
    });
    // Every name has to be on this squad, so a register cannot quietly collect
    // players who were never going to be at it.
    const ids = [...new Set(entries.map((entry) => entry.playerId))];
    if (ids.length) {
      const onSquad = await c.env.DB.prepare(`SELECT id FROM players WHERE team_id=? AND id IN (${ids.map(() => "?").join(",")})`).bind(session.team_id, ...ids).all<{ id: string }>();
      const known = new Set(onSquad.results.map((row) => row.id));
      const stranger = ids.find((id) => !known.has(id));
      if (stranger) throw new ApiProblem(422, "player_not_found", "Mark only players from this squad.");
    }
    const now = nowIso();
    if (entries.length) {
      await c.env.DB.batch(entries.map((entry) => entry.status === null
        ? c.env.DB.prepare("DELETE FROM training_attendance WHERE training_session_id=? AND player_id=?").bind(session.id, entry.playerId)
        : c.env.DB.prepare(`INSERT INTO training_attendance (training_session_id, player_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(training_session_id, player_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`).bind(session.id, entry.playerId, entry.status, now, now)));
    }
    // The whole register comes back rather than an acknowledgement, so the
    // screen that marked one player has the new tallies without asking again.
    return c.json(await attendanceFor(c.env, session));
  });

  app.put("/api/v1/training-sessions/:id/availability", async (c) => {
    const actor = await currentUser(c);
    const session = await trainingById(c.env, c.req.param("id"));
    await requireTrainingAccess(c, session, actor);
    const body = await jsonObject(c);
    const playerId = actor.role === "admin"
      ? stringField(body, "player_id", { min: 1, max: 36 })!
      : actor.player_id!;
    const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=? AND team_id=?").bind(playerId, session.team_id).first<PlayerRow>();
    if (!player) throw new ApiProblem(422, "player_not_found", "Choose a player from this squad.");
    const status = enumField(body, "status", ["going", "not_going"] as const);
    const note = stringField(body, "note", { optional: true, nullable: true, max: 500 }) ?? null;
    const existing = await c.env.DB.prepare("SELECT * FROM training_availability WHERE training_session_id=? AND player_id=?").bind(session.id, playerId).first<AvailabilityRow>();
    const now = nowIso();
    const row: AvailabilityRow = { id: existing?.id ?? crypto.randomUUID(), training_session_id: session.id, player_id: playerId, status, note, created_at: existing?.created_at ?? now, updated_at: now };
    await c.env.DB.prepare(`INSERT INTO training_availability (id, training_session_id, player_id, status, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(training_session_id, player_id) DO UPDATE SET status=excluded.status, note=excluded.note, updated_at=excluded.updated_at`).bind(row.id, row.training_session_id, row.player_id, row.status, row.note, row.created_at, row.updated_at).run();
    return c.json({ ...row, player: publicPlayer(player) });
  });
}

export { requireTrainingAccess, trainingById };
