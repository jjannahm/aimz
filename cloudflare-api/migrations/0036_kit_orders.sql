-- Kit orders, brought onto this API from the Firebase form they used to live in.
--
-- The old form asked a parent to type a child's name and date of birth into an
-- open database. Here an order names a roster player instead: the identity is
-- already on file, so nothing about a child is written down twice, and there is
-- nothing to read without an account.
--
-- team_label is deliberately free text rather than a team_id. The names the kit
-- supplier works to — Hammers, Senzo 2013, Batal 2011 — are not the squads this
-- app rosters, and pretending they are the same thing would make an order
-- unfillable.
CREATE TABLE kit_orders (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  -- Who placed it. SET NULL rather than CASCADE: an order still has to be
  -- filled after the account that made it is gone.
  ordered_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  team_label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('player', 'goalkeeper')),
  shirt_name TEXT NOT NULL,
  shirt_number INTEGER CHECK (shirt_number IS NULL OR (shirt_number >= 0 AND shirt_number <= 99)),
  -- The sizes the supplier offers: children's by age, then adult letters.
  kit_size TEXT NOT NULL CHECK (kit_size IN ('4','6','8','10','12','14','16','S','M','L','XL')),
  hoodie_size TEXT NOT NULL CHECK (hoodie_size IN ('4','6','8','10','12','14','16','S','M','L','XL')),
  outwear_size TEXT NOT NULL CHECK (outwear_size IN ('4','6','8','10','12','14','16','S','M','L','XL')),
  delivery TEXT NOT NULL CHECK (delivery IN ('branch', 'home')),
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'fulfilled', 'cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A family reads their own orders newest first; the academy works the open ones.
CREATE INDEX ix_kit_orders_player ON kit_orders(player_id, created_at DESC);
CREATE INDEX ix_kit_orders_status ON kit_orders(status, created_at DESC);
