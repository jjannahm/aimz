-- Availability is a two-way answer: going, or not going.
--
-- "Maybe" told a coach nothing they could act on — a squad half-committed is
-- the same as a squad unknown when deciding whether a session can run. The
-- CHECK constraint has to be rebuilt rather than altered, which SQLite cannot
-- do in place, so the table is recreated the way earlier migrations here do it.
--
-- Rows already answered "maybe" are dropped rather than forced to one side or
-- the other: nobody said going and nobody said not going, so the honest state
-- is unanswered, and the player is asked again.
CREATE TABLE training_availability_new (
  id TEXT PRIMARY KEY,
  training_session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('going', 'not_going')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(training_session_id, player_id)
);

INSERT INTO training_availability_new (id, training_session_id, player_id, status, note, created_at, updated_at)
SELECT id, training_session_id, player_id, status, note, created_at, updated_at
FROM training_availability
WHERE status IN ('going', 'not_going');

DROP TABLE training_availability;
ALTER TABLE training_availability_new RENAME TO training_availability;
CREATE INDEX ix_availability_session ON training_availability(training_session_id);
