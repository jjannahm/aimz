import type { Hono } from "hono";
import { ApiProblem, currentUser, jsonObject, nowIso, numberField, publicPlayer, publicTeam, stringField } from "./helpers";
import { assertCanManageTeam, guardPlayer, guardTeam, linkedPlayerIds, managingUser } from "./team-access";
import { requireTrainingAccess, trainingById } from "./training";
import type { PlayerRow, TeamRow, TrainingMetricRow, TrainingPlayerMetricRow, TrainingRow } from "./types";
import { attendedSql, lateSql } from "./attendance";

type App = Hono<{ Bindings: Env }>;
type PlayerKind = "outfield" | "goalkeeper";

const playerKind = (position: string): PlayerKind => position.trim().toUpperCase() === "GK" ? "goalkeeper" : "outfield";
const appliesTo = (metric: TrainingMetricRow, position: string): boolean =>
  metric.player_kind === "all" || metric.player_kind === playerKind(position);

const MIN_LEADERBOARD_SESSIONS = 3;
const TRAINING_AWARD_LABELS: Record<string, string> = {
  overall_rating: "Best Overall Rating",
  dribbling: "Best Dribbler",
  shooting: "Best Shooter",
  passing: "Best Passer",
  shot_stopping: "Best Shot Stopper",
  handling: "Best Handling",
  distribution: "Best Distribution",
};

interface TrainingRank {
  rank: number;
  metric: Record<string, unknown>;
  label: string;
  player: Record<string, unknown> | null;
  team: Record<string, unknown> | null;
  value: number;
  unit: string;
  sessions: number;
}

/** The metrics on offer, in the order a coach reads them. */
async function activeMetrics(env: Env, kind?: PlayerKind): Promise<TrainingMetricRow[]> {
  const rows = await env.DB.prepare("SELECT * FROM training_metrics WHERE is_active=1 ORDER BY sort_order, label").all<TrainingMetricRow>();
  return kind ? rows.results.filter((metric) => metric.player_kind === "all" || metric.player_kind === kind) : rows.results;
}

function publicMetric(row: TrainingMetricRow): Record<string, unknown> {
  return { ...row, is_active: Boolean(row.is_active) };
}

/** All eligible rankings for a squad, keyed by attendance or metric key. */
async function trainingAwardRankings(env: Env, team: TeamRow): Promise<Map<string, TrainingRank[]>> {
  const [players, metrics, attendance, readings] = await Promise.all([
    env.DB.prepare("SELECT * FROM players WHERE team_id=? AND is_active=1 ORDER BY name").bind(team.id).all<PlayerRow>(),
    activeMetrics(env),
    env.DB.prepare(`SELECT a.player_id, a.status
      FROM training_attendance a JOIN training_sessions s ON s.id=a.training_session_id
      WHERE s.team_id=?`).bind(team.id).all<{ player_id: string; status: string }>(),
    env.DB.prepare(`SELECT m.player_id, m.metric_id, m.value
      FROM training_player_metrics m JOIN training_sessions s ON s.id=m.training_session_id
      WHERE s.team_id=?`).bind(team.id).all<{ player_id: string; metric_id: string; value: number }>(),
  ]);
  const playerById = new Map(players.results.map((player) => [player.id, player]));
  const teamPublic = publicTeam(team);
  const rankings = new Map<string, TrainingRank[]>();
  const attendanceByPlayer = new Map<string, { attended: number; sessions: number }>();
  for (const row of attendance.results) {
    if (!playerById.has(row.player_id)) continue;
    const held = attendanceByPlayer.get(row.player_id) ?? { attended: 0, sessions: 0 };
    held.sessions += 1;
    if (row.status === "present" || row.status === "late") held.attended += 1;
    attendanceByPlayer.set(row.player_id, held);
  }
  const attendanceMetric = { key: "attendance", label: "Attendance", kind: "rating", min_value: 0, max_value: 100, unit: "%", player_kind: "all" };
  const attendanceRanks = [...attendanceByPlayer.entries()]
    .filter(([, total]) => total.sessions >= MIN_LEADERBOARD_SESSIONS)
    .map(([id, total]) => ({ player: playerById.get(id)!, ...total, raw: total.attended / total.sessions }))
    .sort((a, b) => b.raw - a.raw || b.attended - a.attended || a.player.name.localeCompare(b.player.name))
    .map((row, index): TrainingRank => ({
      rank: index + 1, metric: attendanceMetric, label: "Best Attendance", player: publicPlayer(row.player), team: teamPublic,
      value: Math.round(row.raw * 100), unit: "%", sessions: row.sessions,
    }));
  if (attendanceRanks.length) rankings.set("attendance", attendanceRanks);

  const readingsByMetric = new Map<string, Map<string, number[]>>();
  for (const row of readings.results) {
    const player = playerById.get(row.player_id);
    const metric = metrics.find((item) => item.id === row.metric_id);
    if (!player || !metric || !appliesTo(metric, player.position)) continue;
    const byPlayer = readingsByMetric.get(metric.id) ?? new Map<string, number[]>();
    const values = byPlayer.get(player.id) ?? [];
    values.push(row.value);
    byPlayer.set(player.id, values);
    readingsByMetric.set(metric.id, byPlayer);
  }
  for (const metric of metrics) {
    const eligible = [...(readingsByMetric.get(metric.id) ?? new Map<string, number[]>()).entries()]
      .filter(([, values]) => values.length >= MIN_LEADERBOARD_SESSIONS)
      .map(([id, values]) => ({ player: playerById.get(id)!, sessions: values.length, total: values.reduce((sum, value) => sum + value, 0) }));
    eligible.sort((a, b) => metric.kind === "rating"
      ? (b.total / b.sessions) - (a.total / a.sessions) || b.sessions - a.sessions || a.player.name.localeCompare(b.player.name)
      : b.total - a.total || a.sessions - b.sessions || a.player.name.localeCompare(b.player.name));
    const label = TRAINING_AWARD_LABELS[metric.key] ?? `Best ${metric.label}`;
    const rows = eligible.map((row, index): TrainingRank => ({
      rank: index + 1, metric: publicMetric(metric), label, player: publicPlayer(row.player), team: teamPublic,
      value: metric.kind === "rating" ? Math.round((row.total / row.sessions) * 10) / 10 : row.total,
      unit: metric.kind === "rating" ? `/${metric.max_value ?? 10}` : metric.unit ?? "points", sessions: row.sessions,
    }));
    if (rows.length) rankings.set(metric.key, rows);
  }
  return rankings;
}

/**
 * Refuses a reading a metric cannot hold.
 *
 * A rating carries its own bounds, so the check follows the metric rather than
 * a number written into the app: the academy is still deciding whether these
 * are marks out of ten, and when it changes its mind this keeps working.
 */
function checkValue(metric: TrainingMetricRow, value: number): void {
  if (metric.kind === "rating") {
    const low = metric.min_value ?? 0;
    const high = metric.max_value ?? 10;
    if (value < low || value > high) {
      throw new ApiProblem(422, "validation_error", `${metric.label} is scored from ${low} to ${high}.`, [{ field: metric.key, message: `Enter ${low} to ${high}.` }]);
    }
    return;
  }
  if (value < 0) throw new ApiProblem(422, "validation_error", `${metric.label} cannot be negative.`, [{ field: metric.key, message: "Enter zero or more." }]);
}

/** Every reading for one session, by player then metric. */
async function performanceFor(env: Env, session: TrainingRow): Promise<Record<string, unknown>> {
  const [squad, metrics, readings] = await Promise.all([
    env.DB.prepare("SELECT * FROM players WHERE team_id=? AND is_active=1 ORDER BY name").bind(session.team_id).all<PlayerRow>(),
    activeMetrics(env),
    env.DB.prepare("SELECT * FROM training_player_metrics WHERE training_session_id=?").bind(session.id).all<TrainingPlayerMetricRow>(),
  ]);
  const byPlayer = new Map<string, Record<string, number>>();
  for (const row of readings.results) {
    const held = byPlayer.get(row.player_id) ?? {};
    held[row.metric_id] = row.value;
    byPlayer.set(row.player_id, held);
  }
  return {
    metrics: metrics.map(publicMetric),
    items: squad.results.map((player) => ({ player: publicPlayer(player), values: byPlayer.get(player.id) ?? {} })),
  };
}

export function registerTrainingStatsRoutes(app: App): void {
  app.get("/api/v1/training-metrics", async (c) => {
    await currentUser(c);
    return c.json({ items: (await activeMetrics(c.env)).map(publicMetric) });
  });

  /** Headline winners for attendance and every active metric in one squad. */
  app.get("/api/v1/teams/:id/training-awards", async (c) => {
    await guardTeam(c, c.req.param("id"));
    const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id=? AND is_active=1").bind(c.req.param("id")).first<TeamRow>();
    if (!team) throw new ApiProblem(404, "team_not_found", "Squad not found.");
    const rankings = await trainingAwardRankings(c.env, team);
    return c.json({ team: publicTeam(team), player_awards: [...rankings.values()].map((rows) => rows[0]) });
  });

  /** The full ranking behind one squad training award. */
  app.get("/api/v1/teams/:id/training-awards/:metric", async (c) => {
    await guardTeam(c, c.req.param("id"));
    const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id=? AND is_active=1").bind(c.req.param("id")).first<TeamRow>();
    if (!team) throw new ApiProblem(404, "team_not_found", "Squad not found.");
    const limit = Math.min(Math.max(Number.parseInt(new URL(c.req.url).searchParams.get("limit") ?? "25", 10) || 25, 1), 100);
    const rows = (await trainingAwardRankings(c.env, team)).get(c.req.param("metric"));
    if (!rows) throw new ApiProblem(404, "award_not_found", "Unknown or unqualified training award.");
    return c.json(rows.slice(0, limit));
  });

  /** The whole squad's readings for one session, which is what the entry screen fills in. */
  app.get("/api/v1/training-sessions/:id/performance", async (c) => {
    const session = await trainingById(c.env, c.req.param("id"));
    await requireTrainingAccess(c, session);
    return c.json(await performanceFor(c.env, session));
  });

  /**
   * Records readings. Only what is sent is touched, so a coach correcting one
   * number does not wipe the rest of the session, and a null clears a reading
   * rather than storing a zero — which for a rating would be a mark, not a gap.
   */
  app.put("/api/v1/training-sessions/:id/performance", async (c) => {
    const { scope } = await managingUser(c);
    const session = await trainingById(c.env, c.req.param("id"));
    assertCanManageTeam(scope, session.team_id);
    const body = await jsonObject(c);
    if (!Array.isArray(body.entries) || body.entries.length > 500) {
      throw new ApiProblem(422, "validation_error", "Send up to 500 readings.", [{ field: "entries", message: "Send up to 500 readings." }]);
    }
    const metrics = new Map((await activeMetrics(c.env)).map((metric) => [metric.id, metric]));
    const squad = await c.env.DB.prepare("SELECT id, position FROM players WHERE team_id=?").bind(session.team_id).all<{ id: string; position: string }>();
    const onSquad = new Map(squad.results.map((row) => [row.id, row]));

    const entries = body.entries.map((raw) => {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const playerId = stringField(entry, "player_id", { min: 1, max: 36 })!;
      const metricId = stringField(entry, "metric_id", { min: 1, max: 36 })!;
      const metric = metrics.get(metricId);
      if (!metric) throw new ApiProblem(422, "metric_not_found", "That is not a training metric.");
      const player = onSquad.get(playerId);
      if (!player) throw new ApiProblem(422, "player_not_found", "Record only players from this squad.");
      if (!appliesTo(metric, player.position)) {
        throw new ApiProblem(422, "metric_not_applicable", `${metric.label} does not apply to this player's position.`);
      }
      if (entry.value === null || entry.value === undefined) return { playerId, metricId, value: null };
      const value = numberField(entry, "value", { min: -1_000_000, max: 1_000_000 })!;
      checkValue(metric, value);
      return { playerId, metricId, value };
    });

    const now = nowIso();
    if (entries.length) {
      await c.env.DB.batch(entries.map((entry) => entry.value === null
        ? c.env.DB.prepare("DELETE FROM training_player_metrics WHERE training_session_id=? AND player_id=? AND metric_id=?").bind(session.id, entry.playerId, entry.metricId)
        : c.env.DB.prepare(`INSERT INTO training_player_metrics (training_session_id, player_id, metric_id, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(training_session_id, player_id, metric_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
          .bind(session.id, entry.playerId, entry.metricId, entry.value, now, now)));
    }
    return c.json(await performanceFor(c.env, session));
  });

  /**
   * One player's training record: what they attended, how they were marked, and
   * a session-by-session history.
   *
   * Attendance is counted from the register rather than stored as a metric —
   * there is one truth about whether somebody turned up and it already exists.
   */
  app.get("/api/v1/players/:id/training-stats", async (c) => {
    const actor = await guardPlayer(c, c.req.param("id"));
    const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(c.req.param("id")).first<PlayerRow>();
    if (!player) throw new ApiProblem(404, "player_not_found", "Player not found.");
    // A family reads their own children; anybody else signed in reads the
    // squad they are part of, the same way match statistics already work.
    if (actor.role === "parent" && !(await linkedPlayerIds(c.env, actor)).includes(player.id)) {
      throw new ApiProblem(403, "player_access_denied", "You can only see your own family's training.");
    }

    const [metrics, attendance, squad, readings, sessions] = await Promise.all([
      activeMetrics(c.env, playerKind(player.position)),
      c.env.DB.prepare(`SELECT ${attendedSql()} attended, ${lateSql()} late, COUNT(*) expected FROM training_attendance WHERE player_id=?`).bind(player.id).first<{ attended: number | null; late: number | null; expected: number }>(),
      // What the rest of her squad manages, so her own figure has something to
      // be read against: 80% means one thing in a squad averaging 95 and
      // another in one averaging 60.
      //
      // The squad's own present-to-expected ratio rather than the mean of each
      // player's percentage. A mean of percentages lets somebody marked for a
      // single session swing the whole figure; a ratio weights everybody by how
      // many sessions they were actually marked for. She is counted in it —
      // leaving her out would make two players' figures incomparable.
      c.env.DB.prepare(`SELECT ${attendedSql("a")} attended, COUNT(*) expected
        FROM training_attendance a JOIN players p ON p.id = a.player_id
        WHERE p.team_id = ?`).bind(player.team_id).first<{ attended: number | null; expected: number }>(),
      c.env.DB.prepare(`SELECT m.*, s.starts_at, s.venue, s.id session_id
        FROM training_player_metrics m JOIN training_sessions s ON s.id = m.training_session_id
        WHERE m.player_id = ? ORDER BY s.starts_at DESC`).bind(player.id).all<TrainingPlayerMetricRow & { starts_at: string; venue: string; session_id: string }>(),
      c.env.DB.prepare(`SELECT s.id, s.starts_at, s.venue, a.status
        FROM training_attendance a JOIN training_sessions s ON s.id = a.training_session_id
        WHERE a.player_id = ? ORDER BY s.starts_at DESC`).bind(player.id).all<{ id: string; starts_at: string; venue: string; status: string }>(),
    ]);

    // Totals per metric: a rating is an average of the marks given, a count is
    // the sum of what was counted. Averaging minutes, or adding up marks out of
    // ten, would each be a number that means nothing.
    const totals = metrics.map((metric) => {
      const values = readings.results.filter((row) => row.metric_id === metric.id).map((row) => row.value);
      if (!values.length) return { metric: publicMetric(metric), value: null, sessions: 0 };
      const sum = values.reduce((carry, value) => carry + value, 0);
      return {
        metric: publicMetric(metric),
        value: metric.kind === "rating" ? Math.round((sum / values.length) * 10) / 10 : sum,
        sessions: values.length,
      };
    });

    // One row per session the player has anything recorded against, whether
    // that is a mark, a register entry, or both.
    const bySession = new Map<string, { id: string; starts_at: string; venue: string; status: string | null; values: Record<string, number> }>();
    for (const row of sessions.results) bySession.set(row.id, { id: row.id, starts_at: row.starts_at, venue: row.venue, status: row.status, values: {} });
    const metricIds = new Set(metrics.map((metric) => metric.id));
    for (const row of readings.results) {
      // Retired and position-inapplicable readings stay stored for history but
      // never leak back into the current profile or session breakdown.
      if (!metricIds.has(row.metric_id)) continue;
      const held = bySession.get(row.session_id) ?? { id: row.session_id, starts_at: row.starts_at, venue: row.venue, status: null, values: {} };
      held.values[row.metric_id] = row.value;
      bySession.set(row.session_id, held);
    }
    const history = [...bySession.values()].sort((a, b) => b.starts_at.localeCompare(a.starts_at));

    const attended = attendance?.attended ?? 0;
    const expected = attendance?.expected ?? 0;
    const squadAttended = squad?.attended ?? 0;
    const squadExpected = squad?.expected ?? 0;
    return c.json({
      player: publicPlayer(player),
      metrics: metrics.map(publicMetric),
      attendance: {
        attended,
        // Late is inside `attended` and reported again here: the percentage
        // says she turned up, this says how often she missed the start.
        late: attendance?.late ?? 0,
        expected,
        pct: expected ? Math.round((attended / expected) * 100) : null,
        team_pct: squadExpected ? Math.round((squadAttended / squadExpected) * 100) : null,
      },
      totals,
      sessions: history,
    });
  });
}
