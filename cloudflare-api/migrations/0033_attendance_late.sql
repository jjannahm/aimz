-- A third answer on the register: late.
--
-- Present or absent was never enough. A player who arrives twenty minutes into
-- a session is marked present, which hides it, or absent, which is untrue and
-- costs her a percentage she earned. Punctuality is a real thing a coach tracks
-- and the register could not hold it.
--
-- Late counts as attended everywhere a percentage is worked out, and is counted
-- separately everywhere a figure is shown, so the attendance number stays
-- honest while the lateness stays visible.
--
-- SQLite cannot alter a CHECK, so the table is rebuilt. Unlike the users
-- rebuilds in 0023 and 0032 this one is straightforward: nothing holds a
-- foreign key into training_attendance, so DROP TABLE fires no cascade and
-- there is nothing to copy aside and put back except the rows themselves.
-- No ALTER TABLE, the same way 0032 avoided one.

CREATE TABLE training_attendance_backup AS SELECT * FROM training_attendance;

DROP TABLE training_attendance;

CREATE TABLE training_attendance (
  training_session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'late', 'absent')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (training_session_id, player_id)
);

INSERT INTO training_attendance (training_session_id, player_id, status, created_at, updated_at)
SELECT training_session_id, player_id, status, created_at, updated_at FROM training_attendance_backup;

-- The register for one session, and one player's record across all of them.
CREATE INDEX ix_attendance_session ON training_attendance(training_session_id);
CREATE INDEX ix_attendance_player ON training_attendance(player_id);

DROP TABLE training_attendance_backup;
