CREATE TABLE training_sessions (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 90 CHECK (duration_minutes BETWEEN 15 AND 300),
  venue TEXT NOT NULL,
  notes TEXT,
  series_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_training_team_start ON training_sessions(team_id, starts_at);
CREATE INDEX ix_training_series ON training_sessions(series_id);
