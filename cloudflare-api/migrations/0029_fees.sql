-- What a family owes, and what they have paid.
--
-- Money is whole piastres, never a decimal. SQLite has no DECIMAL type and a
-- REAL cannot hold 12.30 exactly; once part-payments are summed the total
-- drifts, and a charge sits a hundredth short of settled for ever. The currency
-- is EGP throughout and is deliberately not a column: a column that only ever
-- holds one value is a lie waiting to become an inconsistency.

-- The recurring monthly subscription for one squad.
CREATE TABLE fee_plans (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount_piastres INTEGER NOT NULL CHECK (amount_piastres >= 0),
  -- The day a generated charge falls due. 1 to 28 only: not every month has a
  -- 29th, and a plan that silently skips February is worse than one that
  -- cannot be set to the 31st.
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 28),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_fee_plans_team ON fee_plans(team_id);

-- One amount owed by one player. Both kinds live here: a subscription charge
-- carries the plan it came from and the month it covers, a kit or tournament
-- charge carries neither and is entered by hand.
--
-- `amount_piastres` is copied from the plan rather than read through it, for
-- the same reason the audit trail copies the actor's name: a charge already
-- raised must still say what it was raised at after the price changes.
CREATE TABLE fee_charges (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  -- Held alongside the player so a squad's ledger still reads correctly after
  -- that player moves on to another squad.
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  fee_plan_id TEXT REFERENCES fee_plans(id) ON DELETE SET NULL,
  -- 'YYYY-MM' for a monthly charge, null for a one-off.
  period TEXT,
  label TEXT NOT NULL,
  amount_piastres INTEGER NOT NULL CHECK (amount_piastres > 0),
  due_on TEXT NOT NULL,
  -- Cancelled rather than deleted: a charge raised in error still has to
  -- explain a receipt the family may already have seen.
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_fee_charges_player ON fee_charges(player_id);
CREATE INDEX ix_fee_charges_team_period ON fee_charges(team_id, period);

-- The one thing that stops a month being billed twice. Generating charges is a
-- button, and a button gets pressed twice; this makes the second press a no-op
-- rather than a duplicate demand. Partial, because a one-off has no plan and no
-- period and SQLite counts every NULL as distinct — an unfiltered constraint
-- would not restrain the monthly rows at all.
CREATE UNIQUE INDEX ux_fee_charges_monthly
  ON fee_charges(fee_plan_id, player_id, period)
  WHERE fee_plan_id IS NOT NULL AND period IS NOT NULL;

-- Money actually received, and only ever added to.
--
-- Never a running total on the charge: two people recording two instalments
-- from two phones would each read the same figure and write back their own, and
-- one payment would vanish leaving nothing to show it was ever taken. Rows only
-- accumulate, so there is nothing to lose. A refund is a negative row with a
-- note, not a deletion.
CREATE TABLE fee_payments (
  id TEXT PRIMARY KEY,
  fee_charge_id TEXT NOT NULL REFERENCES fee_charges(id) ON DELETE CASCADE,
  amount_piastres INTEGER NOT NULL CHECK (amount_piastres <> 0),
  paid_on TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'instapay', 'bank_transfer', 'other')),
  note TEXT,
  recorded_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Copied, so a receipt still names who took the money after that account goes.
  recorded_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_fee_payments_charge ON fee_payments(fee_charge_id);
