-- Who actually turned up to a training session.
--
-- Separate from training_availability, which is what a player said beforehand.
-- The two disagree often enough to be worth keeping apart: saying you are
-- coming is not the same as coming, and a register is only useful if it records
-- the second.
--
-- A row exists only once a coach has marked that player for that session, so
-- "expected to attend" means "marked either way" rather than "was on the squad
-- at the time". A session nobody took a register for counts against nobody.
CREATE TABLE training_attendance (
  training_session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (training_session_id, player_id)
);

-- The register for one session, and one player's record across all of them.
CREATE INDEX ix_attendance_session ON training_attendance(training_session_id);
CREATE INDEX ix_attendance_player ON training_attendance(player_id);
