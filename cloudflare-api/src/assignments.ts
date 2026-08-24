import type { Context, Hono } from "hono";
import { getJoinedMatch } from "./domain";
import { ApiProblem, adminUser, currentUser, jsonObject, nowIso, publicPlayer, stringField } from "./helpers";
import { requireTrainingAccess, trainingById } from "./training";
import type { AssignmentRow, PlayerRow, UserRow } from "./types";

type App = Hono<{ Bindings: Env }>;

async function assignmentById(env: Env, id: string): Promise<AssignmentRow> {
  const row = await env.DB.prepare("SELECT * FROM event_assignments WHERE id=?").bind(id).first<AssignmentRow>();
  if (!row) throw new ApiProblem(404, "assignment_not_found", "Assignment not found.");
  return row;
}

async function publicAssignments(env: Env, rows: AssignmentRow[]): Promise<Record<string, unknown>[]> {
  const ids = [...new Set(rows.flatMap((row) => row.assigned_player_id ? [row.assigned_player_id] : []))];
  const players = ids.length ? await env.DB.prepare(`SELECT * FROM players WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<PlayerRow>() : { results: [] as PlayerRow[] };
  const byId = new Map(players.results.map((player) => [player.id, player]));
  return rows.map((row) => ({ ...row, assigned_player: publicPlayer(row.assigned_player_id ? byId.get(row.assigned_player_id) ?? null : null) }));
}

async function eligiblePlayer(c: Context<{ Bindings: Env }>, assignment: Pick<AssignmentRow, "match_id" | "training_session_id">, playerId: string): Promise<PlayerRow> {
  const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(playerId).first<PlayerRow>();
  if (!player) throw new ApiProblem(422, "player_not_found", "Choose a roster player.");
  if (assignment.training_session_id) {
    const session = await trainingById(c.env, assignment.training_session_id);
    if (player.team_id !== session.team_id) throw new ApiProblem(422, "assignment_player_ineligible", "Choose a player from the training squad.");
  } else if (assignment.match_id) {
    const match = await getJoinedMatch(c.env, assignment.match_id);
    const eligible = (player.team_id === match.home_team_id && Boolean(match.home_is_aimz)) || (player.team_id === match.away_team_id && Boolean(match.away_is_aimz));
    if (!eligible) throw new ApiProblem(422, "assignment_player_ineligible", "Choose a player from an AIMZ squad in this match.");
  }
  return player;
}

async function accessAssignment(c: Context<{ Bindings: Env }>, row: AssignmentRow, user: UserRow): Promise<void> {
  if (user.role === "admin" || !row.training_session_id) return;
  await requireTrainingAccess(c, await trainingById(c.env, row.training_session_id), user);
}

async function createAssignment(c: Context<{ Bindings: Env }>, refs: Pick<AssignmentRow, "match_id" | "training_session_id">): Promise<Response> {
  await adminUser(c);
  if (refs.match_id) await getJoinedMatch(c.env, refs.match_id);
  if (refs.training_session_id) await trainingById(c.env, refs.training_session_id);
  const body = await jsonObject(c);
  const assignedPlayerId = stringField(body, "assigned_player_id", { optional: true, nullable: true, max: 36 }) ?? null;
  if (assignedPlayerId) await eligiblePlayer(c, refs, assignedPlayerId);
  const now = nowIso();
  const row: AssignmentRow = { id: crypto.randomUUID(), ...refs, title: stringField(body, "title", { min: 2, max: 160 })!, assigned_player_id: assignedPlayerId, created_at: now, updated_at: now };
  await c.env.DB.prepare("INSERT INTO event_assignments (id, match_id, training_session_id, title, assigned_player_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(row.id, row.match_id, row.training_session_id, row.title, row.assigned_player_id, now, now).run();
  return c.json((await publicAssignments(c.env, [row]))[0], 201);
}

export function registerAssignmentRoutes(app: App): void {
  app.get("/api/v1/matches/:id/assignments", async (c) => {
    await currentUser(c);
    await getJoinedMatch(c.env, c.req.param("id"));
    const rows = await c.env.DB.prepare("SELECT * FROM event_assignments WHERE match_id=? ORDER BY created_at").bind(c.req.param("id")).all<AssignmentRow>();
    return c.json(await publicAssignments(c.env, rows.results));
  });
  app.post("/api/v1/matches/:id/assignments", (c) => createAssignment(c, { match_id: c.req.param("id"), training_session_id: null }));
  app.delete("/api/v1/matches/:id/assignments/:assignmentId", async (c) => {
    await adminUser(c);
    const result = await c.env.DB.prepare("DELETE FROM event_assignments WHERE id=? AND match_id=?").bind(c.req.param("assignmentId"), c.req.param("id")).run();
    if (!result.meta.changes) throw new ApiProblem(404, "assignment_not_found", "Assignment not found.");
    return c.body(null, 204);
  });

  app.get("/api/v1/training-sessions/:id/assignments", async (c) => {
    const user = await currentUser(c);
    const session = await trainingById(c.env, c.req.param("id"));
    await requireTrainingAccess(c, session, user);
    const rows = await c.env.DB.prepare("SELECT * FROM event_assignments WHERE training_session_id=? ORDER BY created_at").bind(session.id).all<AssignmentRow>();
    return c.json(await publicAssignments(c.env, rows.results));
  });
  app.post("/api/v1/training-sessions/:id/assignments", (c) => createAssignment(c, { match_id: null, training_session_id: c.req.param("id") }));
  app.delete("/api/v1/training-sessions/:id/assignments/:assignmentId", async (c) => {
    await adminUser(c);
    const result = await c.env.DB.prepare("DELETE FROM event_assignments WHERE id=? AND training_session_id=?").bind(c.req.param("assignmentId"), c.req.param("id")).run();
    if (!result.meta.changes) throw new ApiProblem(404, "assignment_not_found", "Assignment not found.");
    return c.body(null, 204);
  });

  app.patch("/api/v1/event-assignments/:id", async (c) => {
    const user = await currentUser(c);
    const row = await assignmentById(c.env, c.req.param("id"));
    await accessAssignment(c, row, user);
    const body = await jsonObject(c);
    const requested = stringField(body, "assigned_player_id", { nullable: true, max: 36 }) ?? null;
    if (user.role === "admin") {
      if (requested) await eligiblePlayer(c, row, requested);
    } else {
      if (requested !== null && requested !== user.player_id) throw new ApiProblem(403, "assignment_self_only", "You can only sign up yourself.");
      if (!user.player_id) throw new ApiProblem(403, "player_link_required", "Ask an AIMZ administrator to link your account before signing up.");
      await eligiblePlayer(c, row, user.player_id);
      if (requested && row.assigned_player_id && row.assigned_player_id !== user.player_id) throw new ApiProblem(409, "assignment_taken", "Another player has already signed up.");
      if (requested === null && row.assigned_player_id !== user.player_id) throw new ApiProblem(403, "assignment_release_denied", "You can only release an assignment you hold.");
    }
    const updated = nowIso();
    if (user.role === "admin") {
      await c.env.DB.prepare("UPDATE event_assignments SET assigned_player_id=?, updated_at=? WHERE id=?").bind(requested, updated, row.id).run();
    } else if (requested) {
      const claimed = await c.env.DB.prepare("UPDATE event_assignments SET assigned_player_id=?, updated_at=? WHERE id=? AND (assigned_player_id IS NULL OR assigned_player_id=?)").bind(requested, updated, row.id, user.player_id).run();
      if (!claimed.meta.changes) throw new ApiProblem(409, "assignment_taken", "Another player has already signed up.");
    } else {
      const released = await c.env.DB.prepare("UPDATE event_assignments SET assigned_player_id=NULL, updated_at=? WHERE id=? AND assigned_player_id=?").bind(updated, row.id, user.player_id).run();
      if (!released.meta.changes) throw new ApiProblem(403, "assignment_release_denied", "You can only release an assignment you hold.");
    }
    return c.json((await publicAssignments(c.env, [{ ...row, assigned_player_id: requested, updated_at: updated }]))[0]);
  });
}
