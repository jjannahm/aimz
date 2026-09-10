-- An invoice is a statement made on a date.
--
-- The money itself already exists: fee_plans raises the charges, fee_payments
-- records what came in, and where a charge stands is worked out on every read.
-- What was missing was a way to hand a parent a copy — so this stores nothing
-- new about the money, only the act of asking for it: which charges were on
-- the invoice and what they said at the moment it was sent.
--
-- Frozen on purpose. A parent who pays the day after should still be able to
-- open what they were sent and see what it asked for.
CREATE TABLE fee_invoices (
  id TEXT PRIMARY KEY,
  -- Readable, and quotable back over WhatsApp: AIMZ-202609-7QK4TP. Not a
  -- sequential series — nothing here is a tax document.
  reference TEXT NOT NULL UNIQUE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  -- The month an invoice run was for, or NULL for a one-off ask.
  period TEXT,
  -- Typed per invoice and optional: where to send the money. Nothing in this
  -- app stores an account number, and an invoice is not the place to start.
  payment_instructions TEXT,
  snapshot TEXT NOT NULL,
  -- The whole of the credential, as the report links are.
  share_token TEXT UNIQUE,
  issued_at TEXT NOT NULL,
  issued_by_name TEXT NOT NULL,
  first_opened_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ix_fee_invoices_player ON fee_invoices(player_id, issued_at);
CREATE INDEX ix_fee_invoices_team ON fee_invoices(team_id, period);
