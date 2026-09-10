import type { Hono } from "hono";
import { ATTENDANCE_STATUSES } from "./attendance";
import { recordAudit } from "./audit";
import { ApiProblem, currentUser, enumField, jsonObject, nowIso, parsePagination, publicPlayer, stringField } from "./helpers";
import {
  decidesForPlayer,
  linkedPlayerIds,
  managedTeamIds,
  requestsForPlayer,
} from "./team-access";
import type { AttendanceRequestRow, PlayerRow, TrainingRow } from "./types";

type App = Hono<{ Bindings: Env }>;

async function sessionById(env: Env, id: string): Promise<TrainingRow> {
  const row = await env.DB.prepare("SELECT * FROM training_sessions WHERE id=?").bind(id).first<TrainingRow>();
  if (!row) throw new ApiProblem(404, "training_not_found", "Training session not found.");
  return row;
}

async function requestById(env: Env, id: string): Promise<AttendanceRequestRow> {
  const row = await env.DB.prepare("SELECT * FROM training_attendance_requests WHERE id=?").bind(id).first<AttendanceRequestRow>();
  if (!row) throw new ApiProblem(404, "attendance_request_not_found", "Request not found.");
  return row;
}

/** The register's current answer for one player at one session, or null. */
async function markedStatus(env: Env, sessionId: string, playerId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT status FROM training_attendance WHERE training_session_id=? AND player_id=?")
    .bind(sessionId, playerId).first<{ status: string }>();
  return row?.status ?? null;
}

/**
 * A request as it is read, with enough around it to be acted on.
 *
 * The session and the player come along because every screen that lists these
 * needs both — a family reading their own asks "which session was that", and a
 * coach reading a queue asks "which player" — and neither should have to fetch
 * them one row at a time.
 */
function publicRequest(row: AttendanceRequestRow, player: PlayerRow | null, session: TrainingRow | null): Record<string, unknown> {
  return {
    ...row,
    player: publicPlayer(player),
    session: session ? { id: session.id, starts_at: session.starts_at, venue: session.venue, team_id: session.team_id } : null,
  };
}

export function registerAttendanceRequestRoutes(app: App): void {
  /**
   * Ask for a correction.
   *
   * The request records what the register said at the time as well as what is
   * being asked for: a coach reading it a week later needs to know what it was
   * answering, and by then the register may have moved on.
   */
  app.post("/api/v1/training-sessions/:id/attendance-requests", async (c) => {
    const session = await sessionById(c.env, c.req.param("id"));
    const body = await jsonObject(c);
    // The player named, or the account's own record when it speaks for one.
    const asked = stringField(body, "player_id", { optional: true, nullable: true, max: 36 }) ?? null;
    const user = await currentUser(c);
    const mine = await linkedPlayerIds(c.env, user);
    const playerId = asked ?? (mine.length === 1 ? mine[0]! : null);
    if (!playerId) throw new ApiProblem(422, "validation_error", "Say which player this is about.", [{ field: "player_id", message: "Choose a player." }]);
    await requestsForPlayer(c, playerId);

    const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(playerId).first<PlayerRow>();
    if (!player) throw new ApiProblem(404, "player_not_found", "Player not found.");
    // A request about a session that player's squad never had is a request
    // about nothing.
    if (player.team_id !== session.team_id) throw new ApiProblem(422, "player_not_found", "That player is not on this session's squad.");

    const requested = enumField(body, "requested_status", ATTENDANCE_STATUSES);
    const current = await markedStatus(c.env, session.id, playerId);
    if (current === requested) throw new ApiProblem(409, "already_marked", `The register already says ${requested}.`);
    const reason = stringField(body, "reason", { optional: true, nullable: true, max: 500 }) ?? null;

    const now = nowIso();
    const row: AttendanceRequestRow = {
      id: crypto.randomUUID(),
      training_session_id: session.id,
      player_id: playerId,
      requested_by_id: user.id,
      current_status: current,
      requested_status: requested,
      reason,
      status: "pending",
      decided_by_id: null,
      decided_at: null,
      decision_reason: null,
      created_at: now,
      updated_at: now,
    };
    try {
      await c.env.DB.prepare(`INSERT INTO training_attendance_requests
        (id, training_session_id, player_id, requested_by_id, current_status, requested_status, reason, status, decided_by_id, decided_at, decision_reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)`)
        .bind(row.id, row.training_session_id, row.player_id, row.requested_by_id, row.current_status, row.requested_status, row.reason, now, now).run();
    } catch {
      // The partial unique index: one open request per player per session.
      throw new ApiProblem(409, "request_already_open", "There is already a request waiting on this session.");
    }
    return c.json(publicRequest(row, player, session), 201);
  });

  /**
   * The requests this account can see.
   *
   * A family sees their own, whatever their state, because seeing what came of
   * one is the point. An administrator sees the academy's and a manager their
   * own squads', and both usually want `?status=pending` — the queue.
   */
  app.get("/api/v1/attendance-requests", async (c) => {
    const user = await currentUser(c);
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (user.role === "admin") {
      // Everything, filtered only by what was asked for.
    } else if (user.role === "manager") {
      const squads = await managedTeamIds(c.env, user);
      conditions.push(`r.player_id IN (SELECT id FROM players WHERE team_id IN (${squads.map(() => "?").join(",")}))`);
      values.push(...squads);
    } else {
      const mine = await linkedPlayerIds(c.env, user);
      conditions.push(`r.player_id IN (${mine.map(() => "?").join(",")})`);
      values.push(...mine);
    }

    const status = url.searchParams.get("status");
    if (status) { conditions.push("r.status = ?"); values.push(status); }
    const sessionId = url.searchParams.get("training_session_id");
    if (sessionId) { conditions.push("r.training_session_id = ?"); values.push(sessionId); }
    const playerId = url.searchParams.get("player_id");
    if (playerId) { conditions.push("r.player_id = ?"); values.push(playerId); }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";

    const rows = await c.env.DB.prepare(`SELECT r.* FROM training_attendance_requests r${where}
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC LIMIT ? OFFSET ?`)
      .bind(...values, limit, offset).all<AttendanceRequestRow>();
    const count = await c.env.DB.prepare(`SELECT COUNT(*) total FROM training_attendance_requests r${where}`).bind(...values).first<{ total: number }>();

    // The players and sessions these point at, in two reads rather than two
    // per row.
    const playerIds = [...new Set(rows.results.map((row) => row.player_id))];
    const sessionIds = [...new Set(rows.results.map((row) => row.training_session_id))];
    const [players, sessions] = await Promise.all([
      playerIds.length
        ? c.env.DB.prepare(`SELECT * FROM players WHERE id IN (${playerIds.map(() => "?").join(",")})`).bind(...playerIds).all<PlayerRow>()
        : Promise.resolve({ results: [] as PlayerRow[] }),
      sessionIds.length
        ? c.env.DB.prepare(`SELECT * FROM training_sessions WHERE id IN (${sessionIds.map(() => "?").join(",")})`).bind(...sessionIds).all<TrainingRow>()
        : Promise.resolve({ results: [] as TrainingRow[] }),
    ]);
    const playerById = new Map(players.results.map((row) => [row.id, row]));
    const sessionById2 = new Map(sessions.results.map((row) => [row.id, row]));

    return c.json({
      items: rows.results.map((row) => publicRequest(row, playerById.get(row.player_id) ?? null, sessionById2.get(row.training_session_id) ?? null)),
      total: count?.total ?? 0,
      limit,
      offset,
    });
  });

  /**
   * Approve one.
   *
   * The register and the decision are written in the same batch. A correction
   * that marked the request approved but left the register alone — or the other
   * way round — would leave the two disagreeing with nobody able to tell which
   * was right. Training statistics need nothing further: every figure in the
   * app is computed from the register when it is read.
   */
  app.post("/api/v1/attendance-requests/:id/approve", async (c) => {
    const request = await requestById(c.env, c.req.param("id"));
    const actor = await decidesForPlayer(c, request.player_id);
    if (request.status !== "pending") throw new ApiProblem(409, "request_decided", "This request has already been answered.");
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO training_attendance (training_session_id, player_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(training_session_id, player_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`)
        .bind(request.training_session_id, request.player_id, request.requested_status, now, now),
      c.env.DB.prepare("UPDATE training_attendance_requests SET status='approved', decided_by_id=?, decided_at=?, updated_at=? WHERE id=? AND status='pending'")
        .bind(actor.id, now, now, request.id),
      recordAudit(c.env, actor, {
        action: "attendance_request_approved",
        entityType: "training_session",
        entityId: request.training_session_id,
        matchId: null,
        summary: `${request.current_status ?? "unmarked"} to ${request.requested_status}`,
      }),
    ]);
    return c.json(publicRequest({ ...request, status: "approved", decided_by_id: actor.id, decided_at: now, updated_at: now }, null, null));
  });

  /** Reject one. The register is left exactly as it was. */
  app.post("/api/v1/attendance-requests/:id/reject", async (c) => {
    const request = await requestById(c.env, c.req.param("id"));
    const actor = await decidesForPlayer(c, request.player_id);
    if (request.status !== "pending") throw new ApiProblem(409, "request_decided", "This request has already been answered.");
    const body = await jsonObject(c);
    const reason = stringField(body, "reason", { optional: true, nullable: true, max: 500 }) ?? null;
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE training_attendance_requests SET status='rejected', decided_by_id=?, decided_at=?, decision_reason=?, updated_at=? WHERE id=? AND status='pending'")
        .bind(actor.id, now, reason, now, request.id),
      recordAudit(c.env, actor, {
        action: "attendance_request_rejected",
        entityType: "training_session",
        entityId: request.training_session_id,
        matchId: null,
        summary: reason ?? `${request.requested_status} refused`,
      }),
    ]);
    return c.json(publicRequest({ ...request, status: "rejected", decided_by_id: actor.id, decided_at: now, decision_reason: reason, updated_at: now }, null, null));
  });
}
