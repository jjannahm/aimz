-- Shared newcomer intake and squad-scoped coach accounts. SQLite cannot widen
-- the users.role CHECK in place, so preserve every dependent row while users is
-- rebuilt (the same pattern used when parent accounts were introduced).
CREATE TABLE newcomer_users_backup AS SELECT * FROM users;
CREATE TABLE newcomer_refresh_backup AS SELECT * FROM refresh_sessions;
CREATE TABLE newcomer_children_backup AS SELECT * FROM user_children;
CREATE TABLE newcomer_expiry_backup AS SELECT * FROM account_expiry;
CREATE TABLE newcomer_calendar_backup AS SELECT * FROM calendar_tokens;
CREATE TABLE newcomer_invite_author_backup AS SELECT id,created_by_id FROM registration_invites WHERE created_by_id IS NOT NULL;
CREATE TABLE newcomer_announcement_author_backup AS SELECT id,author_id FROM announcements WHERE author_id IS NOT NULL;
CREATE TABLE newcomer_audit_actor_backup AS SELECT id,actor_id FROM audit_log WHERE actor_id IS NOT NULL;
CREATE TABLE newcomer_payment_actor_backup AS SELECT id,recorded_by_id FROM fee_payments WHERE recorded_by_id IS NOT NULL;

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
  SELECT id,name,email,password_hash,role,player_id,is_active,'approved',created_at,updated_at FROM newcomer_users_backup;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX ix_users_email ON users(email);
CREATE INDEX ix_users_role ON users(role);
CREATE INDEX ix_users_onboarding_status ON users(onboarding_status);

INSERT OR IGNORE INTO refresh_sessions SELECT * FROM newcomer_refresh_backup;
INSERT OR IGNORE INTO user_children SELECT * FROM newcomer_children_backup;
INSERT OR IGNORE INTO account_expiry SELECT * FROM newcomer_expiry_backup;
INSERT OR IGNORE INTO calendar_tokens SELECT * FROM newcomer_calendar_backup;
UPDATE registration_invites SET created_by_id=(SELECT created_by_id FROM newcomer_invite_author_backup b WHERE b.id=registration_invites.id) WHERE created_by_id IS NULL;
UPDATE announcements SET author_id=(SELECT author_id FROM newcomer_announcement_author_backup b WHERE b.id=announcements.id) WHERE author_id IS NULL;
UPDATE audit_log SET actor_id=(SELECT actor_id FROM newcomer_audit_actor_backup b WHERE b.id=audit_log.id) WHERE actor_id IS NULL;
UPDATE fee_payments SET recorded_by_id=(SELECT recorded_by_id FROM newcomer_payment_actor_backup b WHERE b.id=fee_payments.id) WHERE recorded_by_id IS NULL;
DROP TABLE newcomer_users_backup;
DROP TABLE newcomer_refresh_backup;
DROP TABLE newcomer_children_backup;
DROP TABLE newcomer_expiry_backup;
DROP TABLE newcomer_calendar_backup;
DROP TABLE newcomer_invite_author_backup;
DROP TABLE newcomer_announcement_author_backup;
DROP TABLE newcomer_audit_actor_backup;
DROP TABLE newcomer_payment_actor_backup;

ALTER TABLE registration_invites ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE registration_invites ADD COLUMN application_id TEXT;
CREATE INDEX ix_registration_invites_team_id ON registration_invites(team_id);

CREATE TABLE newcomer_applications (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('public_link', 'account_registration')),
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','follow_up','trial_booked','closed')),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('joined','not_interested','declined')),
  client_submission_id TEXT UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  invite_id TEXT REFERENCES registration_invites(id) ON DELETE SET NULL,
  suggested_team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  branch TEXT NOT NULL,
  full_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp_mobile TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  nationality TEXT NOT NULL,
  address TEXT NOT NULL,
  previous_academy TEXT NOT NULL,
  school_university TEXT NOT NULL,
  father_name TEXT NOT NULL,
  father_mobile TEXT NOT NULL,
  mother_name TEXT NOT NULL,
  mother_mobile TEXT NOT NULL,
  medical_concerns TEXT NOT NULL,
  medications TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  last_contacted_at TEXT,
  next_follow_up_at TEXT,
  closed_at TEXT,
  reviewed_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  redacted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_newcomers_queue ON newcomer_applications(stage, next_follow_up_at, created_at);
CREATE INDEX ix_newcomers_contact ON newcomer_applications(email, mobile, whatsapp_mobile);

CREATE TABLE newcomer_notes (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES newcomer_applications(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_newcomer_notes_application ON newcomer_notes(application_id, created_at);

CREATE TABLE newcomer_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE team_staff (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, team_id)
);
CREATE INDEX ix_team_staff_team ON team_staff(team_id);

CREATE INDEX ix_registration_invites_application_id ON registration_invites(application_id);
