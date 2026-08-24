CREATE TABLE event_assignments (
  id TEXT PRIMARY KEY,
  match_id TEXT REFERENCES matches(id) ON DELETE CASCADE,
  training_session_id TEXT REFERENCES training_sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assigned_player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((match_id IS NULL) <> (training_session_id IS NULL))
);
CREATE INDEX ix_assignments_match ON event_assignments(match_id);
CREATE INDEX ix_assignments_training ON event_assignments(training_session_id);
