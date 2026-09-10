import type { Hono } from "hono";
import { recordAudit } from "./audit";
import { feeStatus } from "./fees";
import { ApiProblem, currentUser, jsonObject, nowIso, parsePagination, publicPlayer, publicTeam, stringField } from "./helpers";
import { newToken } from "./security";
import { linkedPlayerIds } from "./team-access";
import type { FeeChargeRow, PlayerReportRow, PlayerRow, TeamRow, UserRow } from "./types";
import { managePlayer } from "./team-access";
import { managedTeamIds } from "./team-access";
import { attendedByMonth, attendedSql, lateSql } from "./attendance";

type App = Hono<{ Bindings: Env }>;

/** What a report says, as it stood when it was published. */
interface ReportSnapshot {
  /**
   * Bumped when the shape changes, so an old link keeps rendering. Two adds
   * the training marks; a report published before them has no `training` and
   * is read as having none, which is what it recorded.
   */
  version: 1 | 2 | 3;
  player: { name: string; team_name: string | null; position: string | null; jersey_number: number | null };
  /**
   * `late` arrives at version 3. A report published before it has none and is
   * read as having none, which is what it recorded: the register could not
   * hold the answer at the time.
   */
  attendance: { attended: number; expected: number; pct: number | null; late?: number };
  /** How the player was marked at training over the period. */
  training?: { key: string; label: string; kind: "rating" | "count"; max_value: number | null; value: number; sessions: number }[];
  /**
   * Marks this player has that fall outside the period, if any.
   *
   * A report covering the wrong weeks is silent about it otherwise: the block
   * simply comes back empty and looks broken rather than looking wrong.
   */
  marks_outside?: { sessions: number; first: string; last: string } | null;
  matches: { appearances: number; minutes: number; goals: number; assists: number; yellow_cards: number; red_cards: number };
  fees: { charged_piastres: number; paid_piastres: number; outstanding_piastres: number; overdue: number };
  generated_at: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function dateField(body: Record<string, unknown>, field: string): string {
  const value = stringField(body, field, { min: 10, max: 10 });
  if (!value || !DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ApiProblem(422, "validation_error", "Enter a date as YYYY-MM-DD.", [{ field, message: "Enter a date as YYYY-MM-DD." }]);
  }
  return value;
}

async function reportById(env: Env, id: string): Promise<PlayerReportRow> {
  const row = await env.DB.prepare("SELECT * FROM player_reports WHERE id=?").bind(id).first<PlayerReportRow>();
  if (!row) throw new ApiProblem(404, "report_not_found", "Report not found.");
  return row;
}

/**
 * Everything the report says about the period, worked out now.
 *
 * Used on every read of a draft, so a coach writing one sees the current
 * figures, and once at publish, which is the copy a parent will read.
 */
async function measure(env: Env, report: PlayerReportRow): Promise<ReportSnapshot> {
  const player = await env.DB.prepare("SELECT * FROM players WHERE id=?").bind(report.player_id).first<PlayerRow>();
  const team = await env.DB.prepare("SELECT * FROM teams WHERE id=?").bind(report.team_id).first<TeamRow>();
  const [attendance, marks, outside, matches, charges] = await Promise.all([
    // Only sessions inside the period, and only those somebody took a register
    // for: a session nobody marked counts against nobody.
    env.DB.prepare(`SELECT ${attendedSql("a")} attended, ${lateSql("a")} late, COUNT(*) expected
      FROM training_attendance a JOIN training_sessions s ON s.id = a.training_session_id
      WHERE a.player_id = ? AND s.starts_at >= ? AND s.starts_at < ?`)
      .bind(report.player_id, report.period_start, `${report.period_end}T23:59:59.999Z`)
      .first<{ attended: number | null; late: number | null; expected: number }>(),
    // The marks given inside the period, with the metric they belong to. A
    // rating averages and a count adds up, which is why the kind comes along.
    env.DB.prepare(`SELECT t.key, t.label, t.kind, t.max_value, t.sort_order,
      COUNT(*) sessions, SUM(m.value) total
      FROM training_player_metrics m
      JOIN training_metrics t ON t.id = m.metric_id
      JOIN training_sessions s ON s.id = m.training_session_id
      WHERE m.player_id = ? AND s.starts_at >= ? AND s.starts_at < ?
        AND t.is_active = 1
        AND (t.player_kind = 'all' OR t.player_kind = ?)
      GROUP BY t.id ORDER BY t.sort_order, t.label`)
      .bind(report.player_id, report.period_start, `${report.period_end}T23:59:59.999Z`, player?.position.trim().toUpperCase() === "GK" ? "goalkeeper" : "outfield")
      .all<{ key: string; label: string; kind: "rating" | "count"; max_value: number | null; sort_order: number; sessions: number; total: number }>(),
    // Marked sessions this player has that the period does not cover.
    env.DB.prepare(`SELECT COUNT(DISTINCT s.id) sessions, MIN(s.starts_at) first, MAX(s.starts_at) last
      FROM training_player_metrics m JOIN training_sessions s ON s.id = m.training_session_id
      JOIN training_metrics t ON t.id = m.metric_id
      WHERE m.player_id = ? AND (s.starts_at < ? OR s.starts_at >= ?)
        AND t.is_active = 1
        AND (t.player_kind = 'all' OR t.player_kind = ?)`)
      .bind(report.player_id, report.period_start, `${report.period_end}T23:59:59.999Z`, player?.position.trim().toUpperCase() === "GK" ? "goalkeeper" : "outfield")
      .first<{ sessions: number; first: string | null; last: string | null }>(),
    env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN s.appeared THEN 1 ELSE 0 END), 0) appearances,
      COALESCE(SUM(s.minutes_played), 0) minutes, COALESCE(SUM(s.goals), 0) goals,
      COALESCE(SUM(s.assists), 0) assists, COALESCE(SUM(s.yellow_cards), 0) yellow_cards,
      COALESCE(SUM(s.red_cards), 0) red_cards
      FROM player_match_stats s JOIN matches m ON m.id = s.match_id
      WHERE s.player_id = ? AND m.kickoff_datetime >= ? AND m.kickoff_datetime < ?`)
      .bind(report.player_id, report.period_start, `${report.period_end}T23:59:59.999Z`)
      .first<{ appearances: number; minutes: number; goals: number; assists: number; yellow_cards: number; red_cards: number }>(),
    // Fees are counted by what is owed rather than by when it was charged: a
    // family wants to know where they stand, not what fell inside a window.
    env.DB.prepare("SELECT * FROM fee_charges WHERE player_id = ? AND voided_at IS NULL").bind(report.player_id).all<FeeChargeRow>(),
  ]);

  const chargeIds = charges.results.map((row) => row.id);
  const paidRows = chargeIds.length
    ? await env.DB.prepare(`SELECT fee_charge_id, COALESCE(SUM(amount_piastres), 0) paid FROM fee_payments WHERE fee_charge_id IN (${chargeIds.map(() => "?").join(",")}) GROUP BY fee_charge_id`).bind(...chargeIds).all<{ fee_charge_id: string; paid: number }>()
    : { results: [] as { fee_charge_id: string; paid: number }[] };
  const paidByCharge = new Map(paidRows.results.map((row) => [row.fee_charge_id, row.paid]));
  const day = nowIso().slice(0, 10);
  // A month the player has not yet trained four times in is not money anybody
  // owes, so it must not be counted overdue on a report a parent reads.
  const attendedMonths = await attendedByMonth(env, [report.player_id]);
  const fees = charges.results.reduce((sum, charge) => {
    const paid = paidByCharge.get(charge.id) ?? 0;
    return {
      charged_piastres: sum.charged_piastres + charge.amount_piastres,
      paid_piastres: sum.paid_piastres + paid,
      outstanding_piastres: sum.outstanding_piastres + Math.max(0, charge.amount_piastres - paid),
      overdue: sum.overdue + (feeStatus(charge, paid, day, charge.period ? attendedMonths.get(`${report.player_id}|${charge.period}`) ?? 0 : undefined) === "overdue" ? 1 : 0),
    };
  }, { charged_piastres: 0, paid_piastres: 0, outstanding_piastres: 0, overdue: 0 });

  const attended = attendance?.attended ?? 0;
  const expected = attendance?.expected ?? 0;
  const training = marks.results.map((row) => ({
    key: row.key,
    label: row.label,
    kind: row.kind,
    max_value: row.max_value,
    // Averaging minutes, or adding up marks out of ten, would each be
    // arithmetic that means nothing.
    value: row.kind === "rating" ? Math.round((row.total / row.sessions) * 10) / 10 : row.total,
    sessions: row.sessions,
  }));
  return {
    version: 3,
    player: {
      name: player?.name ?? "Unknown player",
      team_name: team?.name ?? null,
      position: player?.position ?? null,
      jersey_number: player?.jersey_number ?? null,
    },
    attendance: { attended, expected, pct: expected ? Math.round((attended / expected) * 100) : null, late: attendance?.late ?? 0 },
    training,
    marks_outside: outside && outside.sessions > 0 && outside.first && outside.last
      ? { sessions: outside.sessions, first: outside.first, last: outside.last }
      : null,
    matches: {
      appearances: matches?.appearances ?? 0,
      minutes: matches?.minutes ?? 0,
      goals: matches?.goals ?? 0,
      assists: matches?.assists ?? 0,
      yellow_cards: matches?.yellow_cards ?? 0,
      red_cards: matches?.red_cards ?? 0,
    },
    fees,
    generated_at: nowIso(),
  };
}

/** The report as its author sees it, with the whole record attached. */
async function publicReport(env: Env, row: PlayerReportRow): Promise<Record<string, unknown>> {
  const player = await env.DB.prepare("SELECT * FROM players WHERE id=?").bind(row.player_id).first<PlayerRow>();
  const team = await env.DB.prepare("SELECT * FROM teams WHERE id=?").bind(row.team_id).first<TeamRow>();
  // A draft is measured again on every read so the coach writing it sees where
  // the player actually stands; a published one answers with what was frozen.
  const snapshot = row.status === "published" && row.snapshot ? JSON.parse(row.snapshot) as ReportSnapshot : await measure(env, row);
  return {
    ...row,
    player: publicPlayer(player),
    team: publicTeam(team),
    snapshot,
    snapshot_source: row.status === "published" ? "frozen" : "live",
    share_token: row.share_token,
  };
}

/**
 * What the link hands to whoever opens it.
 *
 * No ids of any kind: the address is already the credential, and a report
 * forwarded on should not also carry the keys to look anything else up.
 */
function sharedReport(row: PlayerReportRow): Record<string, unknown> {
  return {
    title: row.title,
    period_start: row.period_start,
    period_end: row.period_end,
    coach_feedback: row.coach_feedback,
    published_at: row.published_at,
    published_by_name: row.published_by_name,
    snapshot: row.snapshot ? JSON.parse(row.snapshot) as ReportSnapshot : null,
  };
}

/** An administrator, or the family of the player the report is about. */
async function requireReportAccess(env: Env, actor: UserRow, report: PlayerReportRow): Promise<void> {
  if (actor.role === "admin") return;
  // A coach reads the reports of the squads they run, drafts included: they
  // are the ones writing them.
  if (actor.role === "coach") {
    if (!(await managedTeamIds(env, actor)).includes(report.team_id)) {
      throw new ApiProblem(403, "team_access_denied", "You can only read your own squad's reports.");
    }
    return;
  }
  // Scoped by player rather than by squad: team scope would hand a parent every
  // child on it, which is the whole thing a report must not do.
  if (!(await linkedPlayerIds(env, actor)).includes(report.player_id)) {
    throw new ApiProblem(403, "player_access_denied", "You can only read your own family's reports.");
  }
  if (report.status !== "published") throw new ApiProblem(403, "report_not_published", "This report has not been shared yet.");
}

export function registerReportRoutes(app: App): void {
  /**
   * The link. Deliberately open, like the calendar feed: the random token in
   * the address is the whole of the credential.
   */
  app.get("/api/v1/reports/:token", async (c) => {
    const row = await c.env.DB.prepare("SELECT * FROM player_reports WHERE share_token = ? AND status = 'published'").bind(c.req.param("token")).first<PlayerReportRow>();
    // One answer for a wrong address, a replaced one and a deleted report, so
    // the link cannot be used to find out which reports exist.
    if (!row) throw new ApiProblem(404, "report_not_found", "No report matches this address.");
    if (!row.first_opened_at) {
      await c.env.DB.prepare("UPDATE player_reports SET first_opened_at=? WHERE id=? AND first_opened_at IS NULL").bind(nowIso(), row.id).run();
    }
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Cache-Control", "private, max-age=300");
    return c.json(sharedReport(row));
  });

  app.get("/api/v1/player-reports", async (c) => {
    const actor = await currentUser(c);
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (actor.role === "admin" || actor.role === "coach") {
      // A coach filters the same way an administrator does, inside their own
      // squads rather than across the academy.
      if (actor.role === "coach") {
        const mine = await managedTeamIds(c.env, actor);
        conditions.push(`team_id IN (${mine.map(() => "?").join(",")})`);
        values.push(...mine);
      }
      for (const [parameter, column] of [["player_id", "player_id"], ["team_id", "team_id"], ["status", "status"]] as const) {
        const value = url.searchParams.get(parameter);
        if (value) { conditions.push(`${column} = ?`); values.push(value); }
      }
    } else {
      const mine = await linkedPlayerIds(c.env, actor);
      conditions.push(`player_id IN (${mine.map(() => "?").join(",")})`);
      values.push(...mine);
      // A family never sees a draft: it is a coach still deciding what to say.
      conditions.push("status = 'published'");
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const [count, rows] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) total FROM player_reports${where}`).bind(...values).first<{ total: number }>(),
      c.env.DB.prepare(`SELECT * FROM player_reports${where} ORDER BY period_end DESC, created_at DESC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<PlayerReportRow>(),
    ]);
    const items = await Promise.all(rows.results.map((row) => publicReport(c.env, row)));
    return c.json({ items, total: count?.total ?? 0, limit, offset });
  });

  app.get("/api/v1/player-reports/:id", async (c) => {
    const actor = await currentUser(c);
    const report = await reportById(c.env, c.req.param("id"));
    await requireReportAccess(c.env, actor, report);
    return c.json(await publicReport(c.env, report));
  });

  app.post("/api/v1/player-reports", async (c) => {
    const body = await jsonObject(c);
    const playerId = stringField(body, "player_id", { min: 1, max: 36 })!;
    const actor = await managePlayer(c, playerId);
    const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(playerId).first<PlayerRow>();
    if (!player) throw new ApiProblem(422, "player_not_found", "Choose a player from the roster.");
    const periodStart = dateField(body, "period_start");
    const periodEnd = dateField(body, "period_end");
    if (periodEnd < periodStart) throw new ApiProblem(422, "validation_error", "The period ends before it starts.", [{ field: "period_end", message: "Choose a date after the start." }]);
    const now = nowIso();
    const row: PlayerReportRow = {
      id: crypto.randomUUID(),
      player_id: player.id,
      team_id: player.team_id,
      title: stringField(body, "title", { min: 2, max: 160 })!,
      period_start: periodStart,
      period_end: periodEnd,
      coach_feedback: stringField(body, "coach_feedback", { optional: true, max: 5000 }) ?? "",
      status: "draft",
      snapshot: null,
      share_token: null,
      published_at: null,
      published_by_name: null,
      first_opened_at: null,
      created_at: now,
      updated_at: now,
    };
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO player_reports (id, player_id, team_id, title, period_start, period_end, coach_feedback, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)")
        .bind(row.id, row.player_id, row.team_id, row.title, row.period_start, row.period_end, row.coach_feedback, now, now),
      recordAudit(c.env, actor, { action: "player_report_created", entityType: "player_report", entityId: row.id, matchId: null, summary: `${player.name} · ${row.title}` }),
    ]);
    return c.json(await publicReport(c.env, row), 201);
  });

  app.patch("/api/v1/player-reports/:id", async (c) => {
    const current = await reportById(c.env, c.req.param("id"));
    await managePlayer(c, current.player_id);
    // A published report is a statement already made. Changing it would change
    // what a parent has read, so it is withdrawn and published again instead.
    if (current.status === "published") throw new ApiProblem(409, "report_published", "Withdraw this report before changing it.");
    const body = await jsonObject(c);
    const row: PlayerReportRow = {
      ...current,
      title: stringField(body, "title", { optional: true, min: 2, max: 160 }) ?? current.title,
      period_start: body.period_start === undefined ? current.period_start : dateField(body, "period_start"),
      period_end: body.period_end === undefined ? current.period_end : dateField(body, "period_end"),
      coach_feedback: body.coach_feedback === undefined ? current.coach_feedback : stringField(body, "coach_feedback", { nullable: true, max: 5000 }) ?? "",
      updated_at: nowIso(),
    };
    await c.env.DB.prepare("UPDATE player_reports SET title=?, period_start=?, period_end=?, coach_feedback=?, updated_at=? WHERE id=?")
      .bind(row.title, row.period_start, row.period_end, row.coach_feedback, row.updated_at, row.id).run();
    return c.json(await publicReport(c.env, row));
  });

  /** Freezes the figures and mints the address the family will be given. */
  app.post("/api/v1/player-reports/:id/publish", async (c) => {
    const report = await reportById(c.env, c.req.param("id"));
    const actor = await managePlayer(c, report.player_id);
    const snapshot = JSON.stringify(await measure(c.env, report));
    const now = nowIso();
    const token = report.share_token ?? newToken();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE player_reports SET status='published', snapshot=?, share_token=?, published_at=?, published_by_name=?, updated_at=? WHERE id=?")
        .bind(snapshot, token, now, actor.name, now, report.id),
      recordAudit(c.env, actor, { action: "player_report_published", entityType: "player_report", entityId: report.id, matchId: null, summary: report.title }),
    ]);
    return c.json(await publicReport(c.env, { ...report, status: "published", snapshot, share_token: token, published_at: now, published_by_name: actor.name }));
  });

  /** Takes the link away without losing the report or what it said. */
  app.post("/api/v1/player-reports/:id/withdraw", async (c) => {
    const report = await reportById(c.env, c.req.param("id"));
    const actor = await managePlayer(c, report.player_id);
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE player_reports SET status='draft', share_token=NULL, first_opened_at=NULL, updated_at=? WHERE id=?").bind(now, report.id),
      recordAudit(c.env, actor, { action: "player_report_withdrawn", entityType: "player_report", entityId: report.id, matchId: null, summary: report.title }),
    ]);
    return c.json(await publicReport(c.env, { ...report, status: "draft", share_token: null, first_opened_at: null }));
  });

  /** A new address for the same report, which is how the old one is revoked. */
  app.post("/api/v1/player-reports/:id/new-link", async (c) => {
    const report = await reportById(c.env, c.req.param("id"));
    const actor = await managePlayer(c, report.player_id);
    if (report.status !== "published") throw new ApiProblem(409, "report_not_published", "Publish this report before sharing it.");
    const token = newToken();
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE player_reports SET share_token=?, first_opened_at=NULL, updated_at=? WHERE id=?").bind(token, now, report.id),
      recordAudit(c.env, actor, { action: "player_report_link_replaced", entityType: "player_report", entityId: report.id, matchId: null, summary: report.title }),
    ]);
    return c.json(await publicReport(c.env, { ...report, share_token: token, first_opened_at: null }));
  });

  app.delete("/api/v1/player-reports/:id", async (c) => {
    const report = await reportById(c.env, c.req.param("id"));
    const actor = await managePlayer(c, report.player_id);
    if (report.status === "published") throw new ApiProblem(409, "report_published", "Withdraw this report before deleting it.");
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM player_reports WHERE id=?").bind(report.id),
      recordAudit(c.env, actor, { action: "player_report_deleted", entityType: "player_report", entityId: report.id, matchId: null, summary: report.title }),
    ]);
    return c.body(null, 204);
  });
}
