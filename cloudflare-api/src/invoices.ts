import type { Hono } from "hono";
import { attendedByMonth } from "./attendance";
import { recordAudit } from "./audit";
import { feeStatus, SESSIONS_PER_MONTH, type FeeStatus } from "./fees";
import { ApiProblem, adminUser, jsonObject, nowIso, stringField } from "./helpers";
import { newToken } from "./security";
import type { FeeChargeRow, FeeInvoiceRow, FeePaymentRow, PlayerRow, TeamRow, UserRow } from "./types";

type App = Hono<{ Bindings: Env }>;

/** What an invoice says, as it stood when it was sent. */
export interface InvoiceSnapshot {
  /** Bumped when the shape changes, so an address already sent keeps rendering. */
  version: 1;
  reference: string;
  issued_on: string;
  player: { name: string };
  squad: { name: string | null; branch: string | null };
  /** Only what is actually owed. A month not yet earned is not on here. */
  lines: {
    label: string;
    /** "2026-09" for a monthly subscription, null for a one-off. */
    period: string | null;
    due_on: string;
    amount_piastres: number;
    paid_piastres: number;
    balance_piastres: number;
    status: FeeStatus;
  }[];
  totals: { charged_piastres: number; paid_piastres: number; outstanding_piastres: number; overdue: number };
  /** Free text, typed when the invoice was made. Optional by design. */
  payment_instructions: string | null;
  /**
   * How many months were left off because they are not owed yet.
   *
   * Said out loud rather than silently dropped: a parent comparing the invoice
   * against what they can see in the app should not have to wonder.
   */
  not_due_yet: number;
  generated_at: string;
}

/**
 * A readable reference: the month it was raised in, and six characters.
 *
 * Not sequential. A running number would need a counter that two invoices
 * raised at once could both read, and nothing here is a tax document — this
 * only has to be unique and quotable back over WhatsApp.
 */
function reference(issuedOn: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = crypto.getRandomValues(new Uint8Array(6));
  const tail = [...random].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `AIMZ-${issuedOn.slice(0, 7).replace("-", "")}-${tail}`;
}

/**
 * What this player owes, as of today.
 *
 * Built from the same rows and the same `feeStatus` the admin ledger and the
 * family's own screen read, so a charge cannot say one thing on an invoice and
 * another in the app. Crucially it honours `earned()`: a monthly subscription
 * is not owed until the fourth session of its month has been attended, and an
 * invoice that demanded it anyway would be asking for money the app itself
 * says is not yet due.
 */
export async function buildInvoice(
  env: Env,
  player: PlayerRow,
  team: TeamRow | null,
  options: { period?: string | null; payment_instructions?: string | null; issued_on?: string } = {},
): Promise<InvoiceSnapshot> {
  const today = options.issued_on ?? nowIso().slice(0, 10);
  const charges = await env.DB.prepare("SELECT * FROM fee_charges WHERE player_id=? ORDER BY due_on").bind(player.id).all<FeeChargeRow>();
  const attended = await attendedByMonth(env, [player.id]);
  const ids = charges.results.map((row) => row.id);
  const payments = ids.length
    ? await env.DB.prepare(`SELECT * FROM fee_payments WHERE fee_charge_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<FeePaymentRow>()
    : { results: [] as FeePaymentRow[] };

  const paidByCharge = new Map<string, number>();
  for (const payment of payments.results) {
    paidByCharge.set(payment.fee_charge_id, (paidByCharge.get(payment.fee_charge_id) ?? 0) + payment.amount_piastres);
  }

  const measured = charges.results.map((charge) => {
    const paid = paidByCharge.get(charge.id) ?? 0;
    const sessions = charge.period ? attended.get(`${player.id}|${charge.period}`) ?? 0 : null;
    return { charge, paid, status: feeStatus(charge, paid, today, sessions ?? undefined) };
  });

  // Owed means owed: a charge raised in error and a month not yet earned are
  // both left off, and a settled one has nothing left to ask for.
  const owed = measured.filter((item) => item.status === "unpaid" || item.status === "partial" || item.status === "overdue");
  const lines = owed.map(({ charge, paid, status }) => ({
    label: charge.label,
    period: charge.period,
    due_on: charge.due_on,
    amount_piastres: charge.amount_piastres,
    paid_piastres: paid,
    balance_piastres: Math.max(0, charge.amount_piastres - paid),
    status,
  }));

  return {
    version: 1,
    reference: reference(today),
    issued_on: today,
    player: { name: player.name },
    squad: { name: team?.name ?? null, branch: team?.branch ?? null },
    lines,
    totals: {
      charged_piastres: lines.reduce((total, line) => total + line.amount_piastres, 0),
      paid_piastres: lines.reduce((total, line) => total + line.paid_piastres, 0),
      outstanding_piastres: lines.reduce((total, line) => total + line.balance_piastres, 0),
      overdue: lines.filter((line) => line.status === "overdue").length,
    },
    payment_instructions: options.payment_instructions?.trim() || null,
    not_due_yet: measured.filter((item) => item.status === "not_due").length,
    generated_at: nowIso(),
  };
}

/** What the admin sees: the invoice, and the address for sending it. */
function publicInvoice(row: FeeInvoiceRow, playerName?: string): Record<string, unknown> {
  return {
    id: row.id,
    reference: row.reference,
    player_id: row.player_id,
    player_name: playerName ?? null,
    period: row.period,
    snapshot: JSON.parse(row.snapshot) as InvoiceSnapshot,
    share_token: row.share_token,
    issued_at: row.issued_at,
    issued_by_name: row.issued_by_name,
    first_opened_at: row.first_opened_at,
  };
}

/**
 * What the link hands whoever opens it.
 *
 * No ids of any kind, the rule both report links already keep: the address is
 * the credential, and an invoice forwarded on should not also carry the keys
 * to look a child up with.
 */
function sharedInvoice(row: FeeInvoiceRow): Record<string, unknown> {
  return {
    issued_at: row.issued_at,
    issued_by_name: row.issued_by_name,
    snapshot: JSON.parse(row.snapshot) as InvoiceSnapshot,
  };
}

async function playerAndTeam(env: Env, playerId: string): Promise<{ player: PlayerRow; team: TeamRow | null }> {
  const player = await env.DB.prepare("SELECT * FROM players WHERE id=?").bind(playerId).first<PlayerRow>();
  if (!player) throw new ApiProblem(404, "player_not_found", "Player not found.");
  const team = await env.DB.prepare("SELECT * FROM teams WHERE id=?").bind(player.team_id).first<TeamRow>();
  return { player, team: team ?? null };
}

async function insertInvoice(
  env: Env, actor: UserRow, player: PlayerRow, team: TeamRow | null,
  options: { period?: string | null; payment_instructions?: string | null },
): Promise<FeeInvoiceRow> {
  const snapshot = await buildInvoice(env, player, team, options);
  const now = nowIso();
  const row: FeeInvoiceRow = {
    id: crypto.randomUUID(), reference: snapshot.reference, player_id: player.id, team_id: team?.id ?? null,
    period: options.period ?? null, payment_instructions: snapshot.payment_instructions,
    snapshot: JSON.stringify(snapshot), share_token: newToken(),
    issued_at: now, issued_by_name: actor.name, first_opened_at: null, created_at: now, updated_at: now,
  };
  await env.DB.prepare("INSERT INTO fee_invoices (id, reference, player_id, team_id, period, payment_instructions, snapshot, share_token, issued_at, issued_by_name, first_opened_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?)")
    .bind(row.id, row.reference, row.player_id, row.team_id, row.period, row.payment_instructions, row.snapshot, row.share_token, row.issued_at, row.issued_by_name, row.created_at, row.updated_at).run();
  return row;
}

async function invoiceById(env: Env, id: string): Promise<FeeInvoiceRow> {
  const row = await env.DB.prepare("SELECT * FROM fee_invoices WHERE id=?").bind(id).first<FeeInvoiceRow>();
  if (!row) throw new ApiProblem(404, "invoice_not_found", "Invoice not found.");
  return row;
}

export function registerInvoiceRoutes(app: App): void {
  /**
   * The link. Deliberately open, as both report links are: the random token in
   * the address is the whole of the credential.
   */
  app.get("/api/v1/invoices/:token", async (c) => {
    const row = await c.env.DB.prepare("SELECT * FROM fee_invoices WHERE share_token = ?").bind(c.req.param("token")).first<FeeInvoiceRow>();
    // One answer for a wrong address, a replaced one and a withdrawn invoice.
    if (!row) throw new ApiProblem(404, "invoice_not_found", "No invoice matches this address.");
    if (!row.first_opened_at) {
      await c.env.DB.prepare("UPDATE fee_invoices SET first_opened_at=? WHERE id=? AND first_opened_at IS NULL").bind(nowIso(), row.id).run();
    }
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Cache-Control", "private, max-age=300");
    return c.json(sharedInvoice(row));
  });

  /** Every invoice raised for one player, newest first. */
  app.get("/api/v1/players/:id/invoices", async (c) => {
    await adminUser(c);
    const { player } = await playerAndTeam(c.env, c.req.param("id"));
    const rows = await c.env.DB.prepare("SELECT * FROM fee_invoices WHERE player_id=? ORDER BY issued_at DESC").bind(player.id).all<FeeInvoiceRow>();
    return c.json({ items: rows.results.map((row) => publicInvoice(row, player.name)) });
  });

  /** One invoice, for one player, as of today. */
  app.post("/api/v1/players/:id/invoices", async (c) => {
    const actor = await adminUser(c);
    const body = await jsonObject(c);
    const { player, team } = await playerAndTeam(c.env, c.req.param("id"));
    const options = {
      period: stringField(body, "period", { optional: true, nullable: true, min: 7, max: 7 }) ?? null,
      payment_instructions: stringField(body, "payment_instructions", { optional: true, nullable: true, max: 500 }) ?? null,
    };
    const snapshot = await buildInvoice(c.env, player, team, options);
    if (!snapshot.lines.length) throw new ApiProblem(409, "nothing_owed", `${player.name} has nothing outstanding to invoice.`);
    const row = await insertInvoice(c.env, actor, player, team, options);
    await recordAudit(c.env, actor, { action: "fee_invoice_issued", entityType: "fee_invoice", entityId: row.id, matchId: null, summary: `${player.name} · ${row.reference}` }).run();
    return c.json(publicInvoice(row, player.name), 201);
  });

  /**
   * The monthly run: one invoice for every player in the squad who owes.
   *
   * Players with nothing outstanding are skipped rather than sent an invoice
   * for nothing, and the count of those is returned so the admin can see the
   * run did look at them.
   */
  app.post("/api/v1/teams/:id/invoices", async (c) => {
    const actor = await adminUser(c);
    const body = await jsonObject(c);
    const teamId = c.req.param("id");
    const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id=?").bind(teamId).first<TeamRow>();
    if (!team) throw new ApiProblem(404, "team_not_found", "Squad not found.");
    const options = {
      period: stringField(body, "period", { optional: true, nullable: true, min: 7, max: 7 }) ?? null,
      payment_instructions: stringField(body, "payment_instructions", { optional: true, nullable: true, max: 500 }) ?? null,
    };
    const players = await c.env.DB.prepare("SELECT * FROM players WHERE team_id=? AND is_active=1 ORDER BY name").bind(teamId).all<PlayerRow>();

    const issued: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const player of players.results) {
      const snapshot = await buildInvoice(c.env, player, team, options);
      if (!snapshot.lines.length) { skipped += 1; continue; }
      const row = await insertInvoice(c.env, actor, player, team, options);
      issued.push(publicInvoice(row, player.name));
    }
    await recordAudit(c.env, actor, { action: "fee_invoice_run", entityType: "team", entityId: teamId, matchId: null, summary: `${team.name} · ${issued.length} invoiced` }).run();
    return c.json({ items: issued, skipped }, 201);
  });

  /** A new address for the same invoice, which is how the old one is revoked. */
  app.post("/api/v1/fee-invoices/:id/new-link", async (c) => {
    const actor = await adminUser(c);
    const row = await invoiceById(c.env, c.req.param("id"));
    const token = newToken();
    const now = nowIso();
    await c.env.DB.prepare("UPDATE fee_invoices SET share_token=?, first_opened_at=NULL, updated_at=? WHERE id=?").bind(token, now, row.id).run();
    await recordAudit(c.env, actor, { action: "fee_invoice_link_replaced", entityType: "fee_invoice", entityId: row.id, matchId: null, summary: row.reference }).run();
    return c.json(publicInvoice({ ...row, share_token: token, first_opened_at: null }));
  });

  /** Takes the address away. The invoice stays as the record of the ask. */
  app.post("/api/v1/fee-invoices/:id/withdraw", async (c) => {
    const actor = await adminUser(c);
    const row = await invoiceById(c.env, c.req.param("id"));
    const now = nowIso();
    await c.env.DB.prepare("UPDATE fee_invoices SET share_token=NULL, updated_at=? WHERE id=?").bind(now, row.id).run();
    await recordAudit(c.env, actor, { action: "fee_invoice_withdrawn", entityType: "fee_invoice", entityId: row.id, matchId: null, summary: row.reference }).run();
    return c.json(publicInvoice({ ...row, share_token: null }));
  });
}

/** Kept so the module's one export used elsewhere is obvious. */
export type { FeeStatus };
export { SESSIONS_PER_MONTH };
