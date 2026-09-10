-- The squad-scoped account is called a coach, not a manager.
--
-- 0032 introduced it as 'manager'. AIMZ calls the person who runs a squad a
-- coach, so the role value follows the word the academy actually uses. Only the
-- name changes: user_teams still holds the squads, and everything built on it
-- is untouched.
--
-- Note for anyone reading the schema afterwards: teams.coach is a different
-- thing entirely — a name printed on a team sheet, free text, nothing to do
-- with an account. The two share a word and nothing else.
--
-- users.role carries a CHECK and SQLite will not alter one, so the table is
-- rebuilt the way 0023 and 0032 rebuilt it. Their warning applies unchanged and
-- is the reason for the backups: DROP TABLE performs an implicit DELETE FROM,
-- firing every foreign key aimed at users. Fifteen columns across twelve tables
-- point here now — CASCADE would take user_children, refresh_sessions,
-- account_expiry, calendar_tokens and user_teams away outright, and SET NULL
-- would quietly erase who wrote, recorded, decided or reviewed everything else.
-- All of it is copied aside first and put back after, written to be correct
-- whether or not those actions fire: INSERT OR IGNORE re-adds only rows that
-- went, and each UPDATE touches only a column that came back NULL.
CREATE TABLE coachname_users_backup AS SELECT * FROM users;
CREATE TABLE coachname_children_backup AS SELECT * FROM user_children;
CREATE TABLE coachname_refresh_backup AS SELECT * FROM refresh_sessions;
CREATE TABLE coachname_expiry_backup AS SELECT * FROM account_expiry;
CREATE TABLE coachname_calendar_backup AS SELECT * FROM calendar_tokens;
CREATE TABLE coachname_teams_backup AS SELECT * FROM user_teams;
CREATE TABLE coachname_invite_author_backup AS SELECT id, created_by_id FROM registration_invites WHERE created_by_id IS NOT NULL;
CREATE TABLE coachname_announcement_author_backup AS SELECT id, author_id FROM announcements WHERE author_id IS NOT NULL;
CREATE TABLE coachname_audit_actor_backup AS SELECT id, actor_id FROM audit_log WHERE actor_id IS NOT NULL;
CREATE TABLE coachname_payment_actor_backup AS SELECT id, recorded_by_id FROM fee_payments WHERE recorded_by_id IS NOT NULL;
CREATE TABLE coachname_kit_orderer_backup AS SELECT id, ordered_by_id FROM kit_orders WHERE ordered_by_id IS NOT NULL;
CREATE TABLE coachname_application_user_backup AS SELECT id, user_id FROM newcomer_applications WHERE user_id IS NOT NULL;
CREATE TABLE coachname_application_reviewer_backup AS SELECT id, reviewed_by_id FROM newcomer_applications WHERE reviewed_by_id IS NOT NULL;
CREATE TABLE coachname_note_author_backup AS SELECT id, author_id FROM newcomer_notes WHERE author_id IS NOT NULL;
CREATE TABLE coachname_request_by_backup AS SELECT id, requested_by_id FROM training_attendance_requests WHERE requested_by_id IS NOT NULL;
CREATE TABLE coachname_request_decided_backup AS SELECT id, decided_by_id FROM training_attendance_requests WHERE decided_by_id IS NOT NULL;

DROP TABLE users;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player', 'admin', 'parent', 'coach')),
  player_id TEXT UNIQUE REFERENCES players(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  onboarding_status TEXT NOT NULL DEFAULT 'approved',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The one line this migration exists for: every manager becomes a coach.
INSERT INTO users (id, name, email, password_hash, role, player_id, is_active, onboarding_status, created_at, updated_at)
SELECT id, name, email, password_hash,
       CASE WHEN role = 'manager' THEN 'coach' ELSE role END,
       player_id, is_active, onboarding_status, created_at, updated_at
  FROM coachname_users_backup;

CREATE INDEX ix_users_email ON users(email);
CREATE INDEX ix_users_role ON users(role);
CREATE INDEX ix_users_onboarding_status ON users(onboarding_status);

INSERT OR IGNORE INTO user_children (user_id, player_id, created_at)
  SELECT user_id, player_id, created_at FROM coachname_children_backup;
INSERT OR IGNORE INTO refresh_sessions (id, user_id, token_hash, expires_at, created_at, revoked_at)
  SELECT id, user_id, token_hash, expires_at, created_at, revoked_at FROM coachname_refresh_backup;
INSERT OR IGNORE INTO account_expiry (user_id, expires_at, created_at, updated_at)
  SELECT user_id, expires_at, created_at, updated_at FROM coachname_expiry_backup;
INSERT OR IGNORE INTO calendar_tokens SELECT * FROM coachname_calendar_backup;
INSERT OR IGNORE INTO user_teams SELECT * FROM coachname_teams_backup;

UPDATE registration_invites SET created_by_id = (SELECT created_by_id FROM coachname_invite_author_backup b WHERE b.id = registration_invites.id)
  WHERE created_by_id IS NULL AND id IN (SELECT id FROM coachname_invite_author_backup);
UPDATE announcements SET author_id = (SELECT author_id FROM coachname_announcement_author_backup b WHERE b.id = announcements.id)
  WHERE author_id IS NULL AND id IN (SELECT id FROM coachname_announcement_author_backup);
UPDATE audit_log SET actor_id = (SELECT actor_id FROM coachname_audit_actor_backup b WHERE b.id = audit_log.id)
  WHERE actor_id IS NULL AND id IN (SELECT id FROM coachname_audit_actor_backup);
UPDATE fee_payments SET recorded_by_id = (SELECT recorded_by_id FROM coachname_payment_actor_backup b WHERE b.id = fee_payments.id)
  WHERE recorded_by_id IS NULL AND id IN (SELECT id FROM coachname_payment_actor_backup);
UPDATE kit_orders SET ordered_by_id = (SELECT ordered_by_id FROM coachname_kit_orderer_backup b WHERE b.id = kit_orders.id)
  WHERE ordered_by_id IS NULL AND id IN (SELECT id FROM coachname_kit_orderer_backup);
UPDATE newcomer_applications SET user_id = (SELECT user_id FROM coachname_application_user_backup b WHERE b.id = newcomer_applications.id)
  WHERE user_id IS NULL AND id IN (SELECT id FROM coachname_application_user_backup);
UPDATE newcomer_applications SET reviewed_by_id = (SELECT reviewed_by_id FROM coachname_application_reviewer_backup b WHERE b.id = newcomer_applications.id)
  WHERE reviewed_by_id IS NULL AND id IN (SELECT id FROM coachname_application_reviewer_backup);
UPDATE newcomer_notes SET author_id = (SELECT author_id FROM coachname_note_author_backup b WHERE b.id = newcomer_notes.id)
  WHERE author_id IS NULL AND id IN (SELECT id FROM coachname_note_author_backup);
UPDATE training_attendance_requests SET requested_by_id = (SELECT requested_by_id FROM coachname_request_by_backup b WHERE b.id = training_attendance_requests.id)
  WHERE requested_by_id IS NULL AND id IN (SELECT id FROM coachname_request_by_backup);
UPDATE training_attendance_requests SET decided_by_id = (SELECT decided_by_id FROM coachname_request_decided_backup b WHERE b.id = training_attendance_requests.id)
  WHERE decided_by_id IS NULL AND id IN (SELECT id FROM coachname_request_decided_backup);

DROP TABLE coachname_users_backup;
DROP TABLE coachname_children_backup;
DROP TABLE coachname_refresh_backup;
DROP TABLE coachname_expiry_backup;
DROP TABLE coachname_calendar_backup;
DROP TABLE coachname_teams_backup;
DROP TABLE coachname_invite_author_backup;
DROP TABLE coachname_announcement_author_backup;
DROP TABLE coachname_audit_actor_backup;
DROP TABLE coachname_payment_actor_backup;
DROP TABLE coachname_kit_orderer_backup;
DROP TABLE coachname_application_user_backup;
DROP TABLE coachname_application_reviewer_backup;
DROP TABLE coachname_note_author_backup;
DROP TABLE coachname_request_by_backup;
DROP TABLE coachname_request_decided_backup;
