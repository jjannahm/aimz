import type { Hono } from "hono";
import { feeStatus } from "./fees";
import { ApiProblem, nowIso, publicPlayer, publicTeam } from "./helpers";
import { guardPersonalData } from "./team-access";
import type { FeeChargeRow, FeePaymentRow, PlayerContactRow, PlayerRow, TeamRow } from "./types";

type App = Hono<{ Bindings: Env }>;

/**
 * A player's own details, and her family's money.
 *
 * Two reads, apart from the rest of the API on purpose. Everything else about
 * a player is football — who she plays for, what she did in a match, how she
 * was marked at training — and is answered to whoever may see that squad. This
 * is not football, and is answered only to her own family and an
 * administrator. Keeping the sensitive pair on their own routes is what makes
 * that difference visible rather than buried in a branch.
 *
 * Neither creates a table. Personal details are the roster record that has
 * existed since 0018; financials are a player-shaped view of the fee ledger
 * from 0029, so there is one source of truth for a charge and not two.
 */

/** `1998-04-02` in whole years, as of today. */
function ageFrom(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (Number.isNaN(born.getTime())) return null;
  const today = new Date(nowIso());
  let age = today.getUTCFullYear() - born.getUTCFullYear();
  const month = today.getUTCMonth() - born.getUTCMonth();
  if (month < 0 || (month === 0 && today.getUTCDate() < born.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export function registerPlayerInformationRoutes(app: App): void {
  /**
   * Everything the academy holds about who this player is.
   *
   * Read from the records that already exist rather than from a profile table
   * of its own: the roster record carries the birth date, `player_contacts`
   * carries the people to ring, and the account — where she has one — carries
   * the name and email she signed up with. A field the app does not collect
   * yet simply is not here; when registration starts asking for one it appears
   * without this route being reshaped.
   */
  app.get("/api/v1/players/:id/personal-details", async (c) => {
    await guardPersonalData(c, c.req.param("id"));
    const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(c.req.param("id")).first<PlayerRow>();
    if (!player) throw new ApiProblem(404, "player_not_found", "Player not found.");
    const [team, contacts, account] = await Promise.all([
      c.env.DB.prepare("SELECT * FROM teams WHERE id=?").bind(player.team_id).first<TeamRow>(),
      c.env.DB.prepare("SELECT * FROM player_contacts WHERE player_id=? ORDER BY name").bind(player.id).all<PlayerContactRow>(),
      // A player without an account of her own is ordinary — a young squad is
      // reached through its parents — so this is often null.
      c.env.DB.prepare("SELECT name, email FROM users WHERE player_id=? AND is_active=1").bind(player.id).first<{ name: string; email: string }>(),
    ]);
    return c.json({
      player: publicPlayer(player),
      team: publicTeam(team),
      date_of_birth: player.date_of_birth,
      age: ageFrom(player.date_of_birth),
      account: account ? { name: account.name, email: account.email } : null,
      contacts: contacts.results.map((contact) => ({
        id: contact.id,
        name: contact.name,
        relationship: contact.relationship,
        email: contact.email,
        phone: contact.phone,
      })),
    });
  });

  /**
   * What this player has been charged, what has been paid, and what is left.
   *
   * A view of the fee ledger rather than a second one. Every figure here is
   * summed from `fee_charges` and `fee_payments`, and the status of each charge
   * is worked out on read by the same `feeStatus` the admin ledger uses — so a
   * charge cannot say paid on one screen and overdue on another.
   *
   * Voided charges are listed but excluded from every total: a charge raised
   * in error still has to explain a receipt a family may already have seen,
   * and still must not be money anybody owes.
   */
  app.get("/api/v1/players/:id/financials", async (c) => {
    await guardPersonalData(c, c.req.param("id"));
    const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(c.req.param("id")).first<PlayerRow>();
    if (!player) throw new ApiProblem(404, "player_not_found", "Player not found.");

    const charges = await c.env.DB.prepare("SELECT * FROM fee_charges WHERE player_id=? ORDER BY due_on DESC").bind(player.id).all<FeeChargeRow>();
    const ids = charges.results.map((row) => row.id);
    const payments = ids.length
      ? await c.env.DB.prepare(`SELECT * FROM fee_payments WHERE fee_charge_id IN (${ids.map(() => "?").join(",")}) ORDER BY paid_on DESC`).bind(...ids).all<FeePaymentRow>()
      : { results: [] as FeePaymentRow[] };

    const paidByCharge = new Map<string, number>();
    for (const payment of payments.results) {
      paidByCharge.set(payment.fee_charge_id, (paidByCharge.get(payment.fee_charge_id) ?? 0) + payment.amount_piastres);
    }
    const today = nowIso().slice(0, 10);

    const items = charges.results.map((charge) => {
      const paid = paidByCharge.get(charge.id) ?? 0;
      return {
        ...charge,
        paid_piastres: paid,
        outstanding_piastres: Math.max(0, charge.amount_piastres - paid),
        status: feeStatus(charge, paid, today),
        payments: payments.results.filter((payment) => payment.fee_charge_id === charge.id),
      };
    });

    const live = items.filter((item) => !item.voided_at);
    const summary = {
      charged_piastres: live.reduce((total, item) => total + item.amount_piastres, 0),
      paid_piastres: live.reduce((total, item) => total + item.paid_piastres, 0),
      outstanding_piastres: live.reduce((total, item) => total + item.outstanding_piastres, 0),
      overdue: live.filter((item) => item.status === "overdue").length,
    };

    return c.json({ player: publicPlayer(player), summary, items });
  });
}
