-- A match report is a statement made on a date.
--
-- The same bargain player_reports strikes, for a fixture rather than a person:
-- the summary an admin reads in the app is worked out fresh every time, and
-- publishing freezes it into `snapshot` so the address handed to a parents'
-- group keeps saying what it said when it was sent. A goal corrected a week
-- later changes the match; it does not rewrite the report already shared.
--
-- One row per match. Publishing again replaces the snapshot in place; asking
-- for a new link replaces the token, which is how the old address is revoked.
CREATE TABLE match_reports (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL,
  -- The whole of the credential, the way a calendar feed's address is. Unique
  -- so a rotation can never collide with a live link.
  share_token TEXT UNIQUE,
  published_at TEXT NOT NULL,
  published_by_name TEXT NOT NULL,
  -- A read receipt: whether anybody has opened the link yet, not who.
  first_opened_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_match_reports_match ON match_reports(match_id);
