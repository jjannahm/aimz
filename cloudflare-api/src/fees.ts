import type { Context, Hono } from "hono";
import { recordAudit } from "./audit";
import { ApiProblem, adminUser, currentUser, enumField, jsonObject, nowIso, numberField, parsePagination, publicPlayer, publicTeam, stringField } from "./helpers";
import { linkedPlayerIds, requireAimzTeam } from "./team-access";
import type { FeeChargeRow, FeePaymentRow, FeePlanRow, PlayerRow, TeamRow, UserRow } from "./types";

type App = Hono<{ Bindings: Env }>;

/** Where a charge stands. Worked out on every read rather than stored. */
export type FeeStatus = "void" | "paid" | "partial" | "overdue" | "unpaid";

/**
 * A stored status would be a second version of the truth, and it would go stale
 * the moment the clock passed a due date — with no scheduled worker in this
 * app, nothing would be running to move it on. Derived, it is right at one
 * minute past midnight without anybody having deployed anything.
 */
export function feeStatus(charge: { amount_piastres: number; due_on: string; voided_at: string | null }, paid: number, today: string): FeeStatus {
  if (charge.voided_at) return "void";
  if (paid >= charge.amount_piastres) return "paid";
  const late = charge.due_on < today;
  if (late) return "overdue";
  return paid > 0 ? "partial" : "unpaid";
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const today = () => nowIso().slice(0, 10);

function periodField(body: Record<string, unknown>, field = "period"): string {
  const value = stringField(body, field, { min: 7, max: 7 });
  if (!value || !PERIOD.test(value)) throw new ApiProblem(422, "validation_error", "Enter a month as YYYY-MM.", [{ field, message: "Enter a month as YYYY-MM." }]);
  return value;
}

function dateField(body: Record<string, unknown>, field: string): string {
  const value = stringField(body, field, { min: 10, max: 10 });
  if (!value || !DATE.test(value) || Number.isNaN(Date.parse(value))) throw new ApiProblem(422, "validation_error", "Enter a date as YYYY-MM-DD.", [{ field, message: "Enter a date as YYYY-MM-DD." }]);
  return value;
}

/** The day a monthly charge falls due, clamped into the month it belongs to. */
const dueOn = (period: string, day: number) => `${period}-${String(day).padStart(2, "0")}`;

async function planById(env: Env, id: string): Promise<FeePlanRow> {
  const row = await env.DB.prepare("SELECT * FROM fee_plans WHERE id=?").bind(id).first<FeePlanRow>();
  if (!row) throw new ApiProblem(404, "fee_plan_not_found", "Fee plan not found.");
  return row;
}

/**
 * The squad a charge belongs to, by way of the player it was raised against.
 *
 * Every fee route past the plan reaches a team through this, so a manager's
 * reach over money is exactly their reach over the roster.
 */
async function chargeTeamId(env: Env, charge: FeeChargeRow): Promise<string> {
  const player = await env.DB.prepare("SELECT team_id FROM players WHERE id=?").bind(charge.player_id).first<{ team_id: string }>();
  if (!player) throw new ApiProblem(404, "player_not_found", "Player not found.");
  return player.team_id;
}

async function chargeById(env: Env, id: string): Promise<FeeChargeRow> {
  const row = await env.DB.prepare("SELECT * FROM fee_charges WHERE id=?").bind(id).first<FeeChargeRow>();
  if (!row) throw new ApiProblem(404, "fee_charge_not_found", "Charge not found.");
  return row;
}

/** What has been paid against each of these charges, as a map. */
async function paidByCharge(env: Env, chargeIds: string[]): Promise<Map<string, number>> {
  if (!chargeIds.length) return new Map();
  const rows = await env.DB.prepare(
    `SELECT fee_charge_id, COALESCE(SUM(amount_piastres), 0) paid FROM fee_payments WHERE fee_charge_id IN (${chargeIds.map(() => "?").join(",")}) GROUP BY fee_charge_id`,
  ).bind(...chargeIds).all<{ fee_charge_id: string; paid: number }>();
  return new Map(rows.results.map((row) => [row.fee_charge_id, row.paid]));
}

function publicPlan(row: FeePlanRow, team: TeamRow | null): Record<string, unknown> {
  return { ...row, is_active: Boolean(row.is_active), team: publicTeam(team) };
}

function publicCharge(row: FeeChargeRow, paid: number, player: PlayerRow | null, payments?: FeePaymentRow[]): Record<string, unknown> {
  return {
    ...row,
    player: publicPlayer(player),
    paid_piastres: paid,
    outstanding_piastres: Math.max(0, row.amount_piastres - paid),
    status: feeStatus(row, paid, today()),
    ...(payments ? { payments } : {}),
  };
}

/**
 * The person taking the money, named on the receipt.
 *
 * Only an administrator records a payment, so this is always an admin; it is
 * read here rather than passed down so every write site names them the same way.
 */
const actorName = (actor: UserRow) => actor.name;

export function registerFeeRoutes(app: App): void {
  // ---- plans -------------------------------------------------------------
  app.get("/api/v1/fee-plans", async (c) => {
    await adminUser(c);
    const url = new URL(c.req.url);
    const teamId = url.searchParams.get("team_id");
    const { limit, offset } = parsePagination(url);
    const where = teamId ? " WHERE team_id = ?" : "";
    const values = teamId ? [teamId] : [];
    const [count, rows] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) total FROM fee_plans${where}`).bind(...values).first<{ total: number }>(),
      c.env.DB.prepare(`SELECT * FROM fee_plans${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<FeePlanRow>(),
    ]);
    const teams = await teamsFor(c.env, rows.results.map((row) => row.team_id));
    return c.json({ items: rows.results.map((row) => publicPlan(row, teams.get(row.team_id) ?? null)), total: count?.total ?? 0, limit, offset });
  });

  app.post("/api/v1/fee-plans", async (c) => {
    const actor = await adminUser(c);
    const body = await jsonObject(c);
    const teamId = stringField(body, "team_id", { min: 1, max: 36 })!;
    await requireAimzTeam(c.env, teamId);
    const now = nowIso();
    const row: FeePlanRow = {
      id: crypto.randomUUID(),
      team_id: teamId,
      label: stringField(body, "label", { min: 2, max: 120 })!,
      amount_piastres: numberField(body, "amount_piastres", { min: 0, max: 100_000_000, integer: true })!,
      due_day: numberField(body, "due_day", { min: 1, max: 28, integer: true })!,
      is_active: 1,
      created_at: now,
      updated_at: now,
    };
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO fee_plans (id, team_id, label, amount_piastres, due_day, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
        .bind(row.id, row.team_id, row.label, row.amount_piastres, row.due_day, now, now),
      recordAudit(c.env, actor, { action: "fee_plan_created", entityType: "fee_plan", entityId: row.id, matchId: null, summary: `${row.label} · ${row.amount_piastres} piastres a month` }),
    ]);
    return c.json(publicPlan(row, await teamOf(c.env, teamId)), 201);
  });

  app.patch("/api/v1/fee-plans/:id", async (c) => {
    const actor = await adminUser(c);
    const current = await planById(c.env, c.req.param("id"));
    const body = await jsonObject(c);
    const row: FeePlanRow = {
      ...current,
      label: stringField(body, "label", { optional: true, min: 2, max: 120 }) ?? current.label,
      amount_piastres: numberField(body, "amount_piastres", { optional: true, min: 0, max: 100_000_000, integer: true }) ?? current.amount_piastres,
      due_day: numberField(body, "due_day", { optional: true, min: 1, max: 28, integer: true }) ?? current.due_day,
      is_active: body.is_active === undefined ? current.is_active : (body.is_active ? 1 : 0),
      updated_at: nowIso(),
    };
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE fee_plans SET label=?, amount_piastres=?, due_day=?, is_active=?, updated_at=? WHERE id=?")
        .bind(row.label, row.amount_piastres, row.due_day, row.is_active, row.updated_at, row.id),
      recordAudit(c.env, actor, { action: "fee_plan_updated", entityType: "fee_plan", entityId: row.id, matchId: null, summary: `${row.label} · ${row.amount_piastres} piastres a month` }),
    ]);
    return c.json(publicPlan(row, await teamOf(c.env, row.team_id)));
  });

  app.delete("/api/v1/fee-plans/:id", async (c) => {
    const actor = await adminUser(c);
    const plan = await planById(c.env, c.req.param("id"));
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM fee_plans WHERE id=?").bind(plan.id),
      recordAudit(c.env, actor, { action: "fee_plan_deleted", entityType: "fee_plan", entityId: plan.id, matchId: null, summary: plan.label }),
    ]);
    return c.body(null, 204);
  });

  /**
   * Raises one charge per player on the squad for the month asked for.
   *
   * There is no scheduled worker in this app, so a month is billed when an
   * administrator says so — which is arguably the right way round anyway. The
   * unique index carries the whole of the idempotency: pressing the button
   * twice reports what it skipped rather than billing anybody twice, and a
   * player who joined mid-month is picked up by pressing it again.
   */
  app.post("/api/v1/fee-plans/:id/generate", async (c) => {
    const actor = await adminUser(c);
    const plan = await planById(c.env, c.req.param("id"));
    const body = await jsonObject(c);
    const period = periodField(body);
    if (!plan.is_active) throw new ApiProblem(409, "fee_plan_inactive", "This plan is no longer running.");
    const squad = await c.env.DB.prepare("SELECT * FROM players WHERE team_id=? AND is_active=1 ORDER BY name").bind(plan.team_id).all<PlayerRow>();
    const existing = await c.env.DB.prepare("SELECT player_id FROM fee_charges WHERE fee_plan_id=? AND period=?").bind(plan.id, period).all<{ player_id: string }>();
    const already = new Set(existing.results.map((row) => row.player_id));
    const wanted = squad.results.filter((player) => !already.has(player.id));
    const now = nowIso();
    if (wanted.length) {
      await c.env.DB.batch([
        ...wanted.map((player) => c.env.DB.prepare(
          `INSERT OR IGNORE INTO fee_charges (id, player_id, team_id, fee_plan_id, period, label, amount_piastres, due_on, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), player.id, plan.team_id, plan.id, period, `${plan.label} · ${period}`, plan.amount_piastres, dueOn(period, plan.due_day), now, now)),
        recordAudit(c.env, actor, { action: "fee_charges_generated", entityType: "fee_plan", entityId: plan.id, matchId: null, summary: `Raised ${wanted.length} charges for ${period}` }),
      ]);
    }
    return c.json({ period, created: wanted.length, skipped: already.size, squad_size: squad.results.length });
  });

  // ---- charges -----------------------------------------------------------
  app.get("/api/v1/fee-charges", async (c) => {
    const actor = await currentUser(c);
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const conditions: string[] = [];
    const values: unknown[] = [];
    // A family sees their own children and nobody else's. Scoped by player
    // rather than by squad: team scope would hand a parent every child on it.
    if (actor.role !== "admin") {
      const mine = await linkedPlayerIds(c.env, actor);
      const asked = url.searchParams.get("player_id");
      if (asked && !mine.includes(asked)) throw new ApiProblem(403, "player_access_denied", "You can only see your own family's fees.");
      const ids = asked ? [asked] : mine;
      conditions.push(`player_id IN (${ids.map(() => "?").join(",")})`);
      values.push(...ids);
    } else {
      for (const [parameter, column] of [["player_id", "player_id"], ["team_id", "team_id"], ["period", "period"]] as const) {
        const value = url.searchParams.get(parameter);
        if (value) { conditions.push(`${column} = ?`); values.push(value); }
      }
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const [count, rows] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) total FROM fee_charges${where}`).bind(...values).first<{ total: number }>(),
      c.env.DB.prepare(`SELECT * FROM fee_charges${where} ORDER BY due_on DESC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<FeeChargeRow>(),
    ]);
    const paid = await paidByCharge(c.env, rows.results.map((row) => row.id));
    const players = await playersFor(c.env, rows.results.map((row) => row.player_id));
    const items = rows.results.map((row) => publicCharge(row, paid.get(row.id) ?? 0, players.get(row.player_id) ?? null));
    const status = url.searchParams.get("status");
    return c.json({ items: status ? items.filter((item) => item.status === status) : items, total: count?.total ?? 0, limit, offset });
  });

  app.get("/api/v1/fee-charges/:id", async (c) => {
    const actor = await currentUser(c);
    const charge = await chargeById(c.env, c.req.param("id"));
    if (actor.role !== "admin" && !(await linkedPlayerIds(c.env, actor)).includes(charge.player_id)) {
      throw new ApiProblem(403, "player_access_denied", "You can only see your own family's fees.");
    }
    const payments = await c.env.DB.prepare("SELECT * FROM fee_payments WHERE fee_charge_id=? ORDER BY paid_on, created_at").bind(charge.id).all<FeePaymentRow>();
    const paid = payments.results.reduce((sum, row) => sum + row.amount_piastres, 0);
    return c.json(publicCharge(charge, paid, await playerOf(c.env, charge.player_id), payments.results));
  });

  app.post("/api/v1/fee-charges", async (c) => {
    const actor = await adminUser(c);
    const body = await jsonObject(c);
    const playerId = stringField(body, "player_id", { min: 1, max: 36 })!;
    const player = await playerOf(c.env, playerId);
    if (!player) throw new ApiProblem(422, "player_not_found", "Choose a player from the roster.");
    const now = nowIso();
    const row: FeeChargeRow = {
      id: crypto.randomUUID(),
      player_id: player.id,
      team_id: player.team_id,
      fee_plan_id: null,
      period: null,
      label: stringField(body, "label", { min: 2, max: 160 })!,
      amount_piastres: numberField(body, "amount_piastres", { min: 1, max: 100_000_000, integer: true })!,
      due_on: dateField(body, "due_on"),
      voided_at: null,
      void_reason: null,
      created_at: now,
      updated_at: now,
    };
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO fee_charges (id, player_id, team_id, fee_plan_id, period, label, amount_piastres, due_on, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)")
        .bind(row.id, row.player_id, row.team_id, row.label, row.amount_piastres, row.due_on, now, now),
      recordAudit(c.env, actor, { action: "fee_charge_created", entityType: "fee_charge", entityId: row.id, matchId: null, summary: `${player.name} · ${row.label} · ${row.amount_piastres} piastres` }),
    ]);
    return c.json(publicCharge(row, 0, player), 201);
  });

  app.patch("/api/v1/fee-charges/:id", async (c) => {
    const actor = await adminUser(c);
    const current = await chargeById(c.env, c.req.param("id"));
    if (current.voided_at) throw new ApiProblem(409, "fee_charge_voided", "This charge has been cancelled.");
    const body = await jsonObject(c);
    const row: FeeChargeRow = {
      ...current,
      label: stringField(body, "label", { optional: true, min: 2, max: 160 }) ?? current.label,
      amount_piastres: numberField(body, "amount_piastres", { optional: true, min: 1, max: 100_000_000, integer: true }) ?? current.amount_piastres,
      due_on: body.due_on === undefined ? current.due_on : dateField(body, "due_on"),
      updated_at: nowIso(),
    };
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE fee_charges SET label=?, amount_piastres=?, due_on=?, updated_at=? WHERE id=?").bind(row.label, row.amount_piastres, row.due_on, row.updated_at, row.id),
      recordAudit(c.env, actor, { action: "fee_charge_updated", entityType: "fee_charge", entityId: row.id, matchId: null, summary: `${row.label} · ${row.amount_piastres} piastres` }),
    ]);
    const paid = (await paidByCharge(c.env, [row.id])).get(row.id) ?? 0;
    return c.json(publicCharge(row, paid, await playerOf(c.env, row.player_id)));
  });

  /** Cancelled, not deleted: a receipt already seen still has to be explained. */
  app.post("/api/v1/fee-charges/:id/void", async (c) => {
    const actor = await adminUser(c);
    const charge = await chargeById(c.env, c.req.param("id"));
    const body = await jsonObject(c);
    const reason = stringField(body, "reason", { optional: true, nullable: true, max: 500 }) ?? null;
    const when = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE fee_charges SET voided_at=?, void_reason=?, updated_at=? WHERE id=?").bind(when, reason, when, charge.id),
      recordAudit(c.env, actor, { action: "fee_charge_voided", entityType: "fee_charge", entityId: charge.id, matchId: null, summary: `${charge.label}${reason ? ` · ${reason}` : ""}` }),
    ]);
    const paid = (await paidByCharge(c.env, [charge.id])).get(charge.id) ?? 0;
    return c.json(publicCharge({ ...charge, voided_at: when, void_reason: reason }, paid, await playerOf(c.env, charge.player_id)));
  });

  // ---- payments ----------------------------------------------------------
  app.post("/api/v1/fee-charges/:id/payments", async (c) => {
    const actor = await adminUser(c);
    const charge = await chargeById(c.env, c.req.param("id"));
    if (charge.voided_at) throw new ApiProblem(409, "fee_charge_voided", "This charge has been cancelled.");
    const body = await jsonObject(c);
    const amount = numberField(body, "amount_piastres", { min: -100_000_000, max: 100_000_000, integer: true })!;
    if (amount === 0) throw new ApiProblem(422, "validation_error", "Enter an amount.", [{ field: "amount_piastres", message: "Enter an amount." }]);
    const alreadyPaid = (await paidByCharge(c.env, [charge.id])).get(charge.id) ?? 0;
    // Taking more than is owed is almost always a typed figure gone wrong, and
    // the message says what is actually outstanding rather than only refusing.
    if (amount > 0 && alreadyPaid + amount > charge.amount_piastres) {
      throw new ApiProblem(422, "validation_error", "That is more than is outstanding.", [{ field: "amount_piastres", message: `${charge.amount_piastres - alreadyPaid} piastres are outstanding.` }]);
    }
    const now = nowIso();
    const row: FeePaymentRow = {
      id: crypto.randomUUID(),
      fee_charge_id: charge.id,
      amount_piastres: amount,
      paid_on: body.paid_on === undefined ? today() : dateField(body, "paid_on"),
      method: enumField(body, "method", ["cash", "instapay", "bank_transfer", "other"] as const),
      note: stringField(body, "note", { optional: true, nullable: true, max: 500 }) ?? null,
      recorded_by_id: actor.id,
      recorded_by_name: actorName(actor),
      created_at: now,
    };
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO fee_payments (id, fee_charge_id, amount_piastres, paid_on, method, note, recorded_by_id, recorded_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(row.id, row.fee_charge_id, row.amount_piastres, row.paid_on, row.method, row.note, row.recorded_by_id, row.recorded_by_name, now),
      recordAudit(c.env, actor, { action: "fee_payment_recorded", entityType: "fee_charge", entityId: charge.id, matchId: null, summary: `${row.amount_piastres} piastres · ${row.method}` }),
    ]);
    const payments = await c.env.DB.prepare("SELECT * FROM fee_payments WHERE fee_charge_id=? ORDER BY paid_on, created_at").bind(charge.id).all<FeePaymentRow>();
    return c.json(publicCharge(charge, alreadyPaid + amount, await playerOf(c.env, charge.player_id), payments.results), 201);
  });

  app.delete("/api/v1/fee-payments/:id", async (c) => {
    const actor = await adminUser(c);
    const payment = await c.env.DB.prepare("SELECT * FROM fee_payments WHERE id=?").bind(c.req.param("id")).first<FeePaymentRow>();
    if (!payment) throw new ApiProblem(404, "fee_payment_not_found", "Payment not found.");
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM fee_payments WHERE id=?").bind(payment.id),
      recordAudit(c.env, actor, { action: "fee_payment_removed", entityType: "fee_charge", entityId: payment.fee_charge_id, matchId: null, summary: `${payment.amount_piastres} piastres` }),
    ]);
    return c.body(null, 204);
  });

  // ---- the squad ledger, which is the view an administrator opens ---------
  app.get("/api/v1/teams/:id/fee-summary", async (c) => {
    await adminUser(c);
    const teamId = c.req.param("id");
    const team = await teamOf(c.env, teamId);
    if (!team) throw new ApiProblem(404, "team_not_found", "Squad not found.");
    const url = new URL(c.req.url);
    const period = url.searchParams.get("period");
    if (period && !PERIOD.test(period)) throw new ApiProblem(422, "validation_error", "Enter a month as YYYY-MM.", [{ field: "period", message: "Enter a month as YYYY-MM." }]);
    // Everything still owed from earlier months comes too, or arrears would
    // disappear the moment the administrator changed the month they were
    // looking at — which is exactly when they are looking for them.
    const where = period ? " AND (period = ? OR period IS NULL OR period < ?)" : "";
    const values: unknown[] = period ? [teamId, period, period] : [teamId];
    const charges = await c.env.DB.prepare(`SELECT * FROM fee_charges WHERE team_id = ?${where} ORDER BY due_on`).bind(...values).all<FeeChargeRow>();
    const live = charges.results.filter((row) => !row.voided_at);
    const paid = await paidByCharge(c.env, live.map((row) => row.id));
    const players = await playersFor(c.env, live.map((row) => row.player_id));
    const now = today();

    const byPlayer = new Map<string, { charged: number; paid: number; statuses: FeeStatus[] }>();
    for (const charge of live) {
      const settled = paid.get(charge.id) ?? 0;
      const entry = byPlayer.get(charge.player_id) ?? { charged: 0, paid: 0, statuses: [] };
      entry.charged += charge.amount_piastres;
      entry.paid += settled;
      entry.statuses.push(feeStatus(charge, settled, now));
      byPlayer.set(charge.player_id, entry);
    }
    const rows = [...byPlayer.entries()].map(([playerId, entry]) => ({
      name: players.get(playerId)?.name ?? "",
      player: publicPlayer(players.get(playerId) ?? null),
      charged_piastres: entry.charged,
      paid_piastres: entry.paid,
      outstanding_piastres: Math.max(0, entry.charged - entry.paid),
      // The worst thing true of any of their charges: somebody a month behind
      // is behind, whatever they have paid since.
      status: entry.statuses.includes("overdue") ? "overdue" : entry.charged <= entry.paid ? "paid" : entry.paid > 0 ? "partial" : "unpaid",
    }));
    // Whoever owes most, first: this list is opened to find who to chase.
    rows.sort((a, b) => b.outstanding_piastres - a.outstanding_piastres || a.name.localeCompare(b.name));
    const totals = rows.reduce((sum, row) => ({
      charged_piastres: sum.charged_piastres + row.charged_piastres,
      paid_piastres: sum.paid_piastres + row.paid_piastres,
      outstanding_piastres: sum.outstanding_piastres + row.outstanding_piastres,
    }), { charged_piastres: 0, paid_piastres: 0, outstanding_piastres: 0 });
    return c.json({
      team: publicTeam(team),
      period,
      totals: {
        ...totals,
        players_total: rows.length,
        players_paid: rows.filter((row) => row.status === "paid").length,
        players_overdue: rows.filter((row) => row.status === "overdue").length,
        players_outstanding: rows.filter((row) => row.outstanding_piastres > 0).length,
      },
      // `name` was only there to sort by; the player object carries it onward.
      players: rows.map(({ name, ...row }) => row),
    });
  });
}

/** One squad, or null. */
async function teamOf(env: Env, id: string): Promise<TeamRow | null> {
  return env.DB.prepare("SELECT * FROM teams WHERE id=?").bind(id).first<TeamRow>();
}

async function teamsFor(env: Env, ids: string[]): Promise<Map<string, TeamRow>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await env.DB.prepare(`SELECT * FROM teams WHERE id IN (${unique.map(() => "?").join(",")})`).bind(...unique).all<TeamRow>();
  return new Map(rows.results.map((row) => [row.id, row]));
}

async function playerOf(env: Env, id: string): Promise<PlayerRow | null> {
  return env.DB.prepare("SELECT * FROM players WHERE id=?").bind(id).first<PlayerRow>();
}

async function playersFor(env: Env, ids: string[]): Promise<Map<string, PlayerRow>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await env.DB.prepare(`SELECT * FROM players WHERE id IN (${unique.map(() => "?").join(",")})`).bind(...unique).all<PlayerRow>();
  return new Map(rows.results.map((row) => [row.id, row]));
}

/** Unused parameter kept for symmetry with the other loaders. */
export type { Context };
