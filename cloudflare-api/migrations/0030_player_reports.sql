-- A period report for one player: attendance, appearances, fees and the
-- coach's own words, as they stood on the day it was published.
--
-- The numbers live in `snapshot` rather than being worked out again from the
-- period each time it is read. A report is a statement made on a date. A parent
-- opening the link in March has to see what the coach signed off in December,
-- not what the same query happens to return after a register was back-marked,
-- a fee was settled and two players left the squad. A draft is recomputed on
-- every read while it is being written; publishing is what freezes it.
CREATE TABLE player_reports (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  -- Copied at creation: the report belongs to the squad the player was in when
  -- it was written, which is not always the squad they are in now.
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  coach_feedback TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  -- Frozen at publish, null while a draft. JSON rather than columns: what a
  -- report reports will change, and one already sent has to keep rendering
  -- under the shape it was written in.
  snapshot TEXT,
  -- The address itself is the credential, as it is for a calendar feed. Minted
  -- at publish, replaced to revoke, cleared when unpublished.
  share_token TEXT UNIQUE,
  published_at TEXT,
  published_by_name TEXT,
  -- Whether anybody has opened the link, which is the nearest thing to a read
  -- receipt an app with no notifications can offer.
  first_opened_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_player_reports_player ON player_reports(player_id, period_start);
CREATE INDEX ix_player_reports_team ON player_reports(team_id, status);
CREATE INDEX ix_player_reports_token ON player_reports(share_token);
