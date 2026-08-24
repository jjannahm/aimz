CREATE TABLE training_availability (
  id TEXT PRIMARY KEY,
  training_session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('going', 'maybe', 'not_going')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(training_session_id, player_id)
);
CREATE INDEX ix_availability_session ON training_availability(training_session_id);
