-- Asking for a register to be corrected.
--
-- A register gets marked wrong, and until now a player who was there and is
-- down as absent had no way to say so and no way to see whether anybody acted
-- on it. The only route was catching a coach in person and hoping.
--
-- A request is not a change. The official record is only ever written by
-- somebody who may write it — an administrator, or the manager of that
-- player's squad — and approving a request is what writes it. That is the whole
-- point of the table: it gives a family a way to be heard without giving them
-- a way to mark their own attendance.
CREATE TABLE training_attendance_requests (
  id TEXT PRIMARY KEY,
  training_session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  -- Who asked: the player herself, or a parent on her behalf. Kept so a
  -- decision can be read back to the person who raised it, and set null rather
  -- than cascading if that account goes — the request still happened.
  requested_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- What the register said when the request was raised, which is not the same
  -- as what it says now. A coach reading this a week later needs to know what
  -- it was answering, not only what it asked for. Null means unmarked.
  current_status TEXT,
  requested_status TEXT NOT NULL CHECK (requested_status IN ('present', 'late', 'absent')),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ix_attendance_requests_player ON training_attendance_requests(player_id);
CREATE INDEX ix_attendance_requests_session ON training_attendance_requests(training_session_id);

-- One open request per player per session: asking twice is asking once, and a
-- coach should not have to work out which of three pending rows to answer.
-- Partial, so a decided request never blocks a later one — a register can be
-- wrong twice.
CREATE UNIQUE INDEX ux_attendance_request_open
  ON training_attendance_requests(training_session_id, player_id) WHERE status = 'pending';
