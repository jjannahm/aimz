-- Own goals and missed penalties are their own kind of event, a substitution
-- records why the player came off, and every admin change to a match is logged.

-- SQLite cannot alter a CHECK constraint, so the event table is rebuilt. The
-- type CHECK is dropped rather than widened: enumField already gates the API
-- and is stricter than the constraint ever was, so a future event type will not
-- need a second rebuild.
--
-- related_event_id must point at match_events_new, NOT at match_events. Dropping
-- the old table performs an implicit DELETE FROM that fires ON DELETE CASCADE, so
-- a self-reference aimed at the old name would wipe every copied row that has a
-- parent event. The RENAME below repoints it at the final name.
CREATE TABLE match_events_new (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  minute INTEGER CHECK (minute IS NULL OR minute BETWEEN 0 AND 150),
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  secondary_player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  related_event_id TEXT REFERENCES match_events_new(id) ON DELETE CASCADE,
  notes TEXT,
  is_penalty INTEGER NOT NULL DEFAULT 0,
  substitution_reason TEXT,
  penalty_outcome TEXT,
  client_operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO match_events_new (
  id, match_id, type, minute, team_id, player_id, secondary_player_id,
  related_event_id, notes, is_penalty, client_operation_id, created_at, updated_at
)
SELECT
  id, match_id, type, minute, team_id, player_id, secondary_player_id,
  related_event_id, notes, is_penalty, client_operation_id, created_at, updated_at
FROM match_events;

DROP TABLE match_events;
ALTER TABLE match_events_new RENAME TO match_events;

CREATE INDEX ix_events_match_minute ON match_events(match_id, minute);
CREATE INDEX ix_events_player ON match_events(player_id);

-- Kept apart from goals so an own goal never inflates a scoring record.
ALTER TABLE player_match_stats ADD COLUMN own_goals INTEGER NOT NULL DEFAULT 0;

-- Picked by an admin once the match is finished, not voted for.
ALTER TABLE matches ADD COLUMN man_of_the_match_player_id TEXT REFERENCES players(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_matches_man_of_the_match_player_id ON matches(man_of_the_match_player_id);

-- Who changed what during a match, so two admins scoring at once leave a trail.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Kept alongside the id so a removed admin's actions still read.
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  match_id TEXT REFERENCES matches(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_log_actor_id ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS ix_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS ix_audit_log_match_created ON audit_log(match_id, created_at);
