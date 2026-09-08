-- How a player trained, as against whether they turned up.
--
-- Attendance already lives in training_attendance and is not repeated here:
-- sessions attended and attendance percentage are counted from those rows.
-- What this adds is what happened once the player was there.
--
-- The metrics are rows rather than columns. An academy that decides next month
-- to record finishing, or first touch, or a bleep test, should be adding a row
-- rather than waiting on a migration and a release — and the same applies to
-- taking one away when it turns out nobody fills it in.
CREATE TABLE training_metrics (
  id TEXT PRIMARY KEY,
  -- Stable across renames: a label is what a coach reads, a key is what the
  -- app and any later import refer to.
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  -- A rating is a judgement on a scale; a count is a quantity of something.
  -- They are aggregated differently — a rating averages, a count adds up — so
  -- the difference has to be recorded rather than guessed from the numbers.
  kind TEXT NOT NULL CHECK (kind IN ('rating', 'count')),
  -- The bounds of a rating, held here rather than in the app: the academy is
  -- still deciding whether these are marks out of ten, and changing that
  -- should be a row rather than a release.
  min_value REAL,
  max_value REAL,
  -- What a count counts, for the label under the figure.
  unit TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_training_metrics_order ON training_metrics(is_active, sort_order);

-- One reading: this player, this session, this metric.
CREATE TABLE training_player_metrics (
  training_session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  metric_id TEXT NOT NULL REFERENCES training_metrics(id) ON DELETE CASCADE,
  value REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (training_session_id, player_id, metric_id)
);
CREATE INDEX ix_training_player_metrics_player ON training_player_metrics(player_id, metric_id);

-- The set to start with. Minutes is a count; the three skills are marks out of
-- ten, which is what the academy asked for while it makes its mind up.
INSERT INTO training_metrics (id, key, label, kind, min_value, max_value, unit, sort_order, is_active, created_at, updated_at) VALUES
  ('m-minutes',   'minutes_trained', 'Minutes trained', 'count',  NULL, NULL, 'minutes', 10, 1, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z'),
  ('m-dribbling', 'dribbling',       'Dribbling',       'rating', 1,    10,   NULL,      20, 1, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z'),
  ('m-shooting',  'shooting',        'Shooting',        'rating', 1,    10,   NULL,      30, 1, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z'),
  ('m-passing',   'passing',         'Passing',         'rating', 1,    10,   NULL,      40, 1, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
