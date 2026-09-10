-- Widening users.role to admit a coach, which SQLite will not do in place.
--
-- users is rebuilt the way 0023 rebuilt it to admit a parent, and the care is
-- the same: DROP TABLE performs an implicit DELETE FROM, firing every foreign
-- key aimed at users. user_children and refresh_sessions would CASCADE away,
-- and created_by_id, author_id, actor_id and recorded_by_id would each be SET
-- NULL, quietly erasing who did what. So everything at risk is copied aside
-- first and put back after, and the restores are written to be correct whether
-- or not those actions fire — that depends on whether foreign keys are enforced
-- while the migration runs.
--
-- team_staff, newcomer_applications and newcomer_notes point at users as well,
-- and 0032 created them, so they are copied aside here for the same reason.
DROP TABLE IF EXISTS coach_users_backup;
DROP TABLE IF EXISTS coach_refresh_backup;
DROP TABLE IF EXISTS coach_children_backup;
DROP TABLE IF EXISTS coach_expiry_backup;
DROP TABLE IF EXISTS coach_calendar_backup;
DROP TABLE IF EXISTS coach_staff_backup;
DROP TABLE IF EXISTS coach_invite_author_backup;
DROP TABLE IF EXISTS coach_announcement_author_backup;
DROP TABLE IF EXISTS coach_audit_actor_backup;
DROP TABLE IF EXISTS coach_payment_actor_backup;
DROP TABLE IF EXISTS coach_application_user_backup;
DROP TABLE IF EXISTS coach_application_reviewer_backup;
DROP TABLE IF EXISTS coach_note_author_backup;

CREATE TABLE coach_users_backup AS SELECT * FROM users;
CREATE TABLE coach_refresh_backup AS SELECT * FROM refresh_sessions;
CREATE TABLE coach_children_backup AS SELECT * FROM user_children;
CREATE TABLE coach_expiry_backup AS SELECT * FROM account_expiry;
CREATE TABLE coach_calendar_backup AS SELECT * FROM calendar_tokens;
CREATE TABLE coach_staff_backup AS SELECT * FROM team_staff;
CREATE TABLE coach_invite_author_backup AS SELECT id,created_by_id FROM registration_invites WHERE created_by_id IS NOT NULL;
CREATE TABLE coach_announcement_author_backup AS SELECT id,author_id FROM announcements WHERE author_id IS NOT NULL;
CREATE TABLE coach_audit_actor_backup AS SELECT id,actor_id FROM audit_log WHERE actor_id IS NOT NULL;
CREATE TABLE coach_payment_actor_backup AS SELECT id,recorded_by_id FROM fee_payments WHERE recorded_by_id IS NOT NULL;
CREATE TABLE coach_application_user_backup AS SELECT id,user_id FROM newcomer_applications WHERE user_id IS NOT NULL;
CREATE TABLE coach_application_reviewer_backup AS SELECT id,reviewed_by_id FROM newcomer_applications WHERE reviewed_by_id IS NOT NULL;
CREATE TABLE coach_note_author_backup AS SELECT id,author_id FROM newcomer_notes WHERE author_id IS NOT NULL;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player','admin','parent','coach')),
  player_id TEXT UNIQUE REFERENCES players(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  onboarding_status TEXT NOT NULL DEFAULT 'approved' CHECK (onboarding_status IN ('pending','approved','declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO users_new(id,name,email,password_hash,role,player_id,is_active,onboarding_status,created_at,updated_at)
  SELECT id,name,email,password_hash,role,player_id,is_active,onboarding_status,created_at,updated_at FROM coach_users_backup;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX ix_users_email ON users(email);
CREATE INDEX ix_users_role ON users(role);
CREATE INDEX ix_users_onboarding_status ON users(onboarding_status);

INSERT OR IGNORE INTO refresh_sessions SELECT * FROM coach_refresh_backup;
INSERT OR IGNORE INTO user_children SELECT * FROM coach_children_backup;
INSERT OR IGNORE INTO account_expiry SELECT * FROM coach_expiry_backup;
INSERT OR IGNORE INTO calendar_tokens SELECT * FROM coach_calendar_backup;
INSERT OR IGNORE INTO team_staff SELECT * FROM coach_staff_backup;
UPDATE registration_invites SET created_by_id=(SELECT created_by_id FROM coach_invite_author_backup b WHERE b.id=registration_invites.id) WHERE created_by_id IS NULL;
UPDATE announcements SET author_id=(SELECT author_id FROM coach_announcement_author_backup b WHERE b.id=announcements.id) WHERE author_id IS NULL;
UPDATE audit_log SET actor_id=(SELECT actor_id FROM coach_audit_actor_backup b WHERE b.id=audit_log.id) WHERE actor_id IS NULL;
UPDATE fee_payments SET recorded_by_id=(SELECT recorded_by_id FROM coach_payment_actor_backup b WHERE b.id=fee_payments.id) WHERE recorded_by_id IS NULL;
UPDATE newcomer_applications SET user_id=(SELECT user_id FROM coach_application_user_backup b WHERE b.id=newcomer_applications.id) WHERE user_id IS NULL;
UPDATE newcomer_applications SET reviewed_by_id=(SELECT reviewed_by_id FROM coach_application_reviewer_backup b WHERE b.id=newcomer_applications.id) WHERE reviewed_by_id IS NULL;
UPDATE newcomer_notes SET author_id=(SELECT author_id FROM coach_note_author_backup b WHERE b.id=newcomer_notes.id) WHERE author_id IS NULL;

DROP TABLE coach_users_backup;
DROP TABLE coach_refresh_backup;
DROP TABLE coach_children_backup;
DROP TABLE coach_expiry_backup;
DROP TABLE coach_calendar_backup;
DROP TABLE coach_staff_backup;
DROP TABLE coach_invite_author_backup;
DROP TABLE coach_announcement_author_backup;
DROP TABLE coach_audit_actor_backup;
DROP TABLE coach_payment_actor_backup;
DROP TABLE coach_application_user_backup;
DROP TABLE coach_application_reviewer_backup;
DROP TABLE coach_note_author_backup;
