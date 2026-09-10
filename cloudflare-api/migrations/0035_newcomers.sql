-- Newcomer intake: an application, the notes taken against it, and the state an
-- account sits in while somebody reads it.
--
-- Everything here is additive — one column appended, tables created — so it
-- commits before anything destructive is attempted and can be retried on its
-- own. Squad-scoped staff are not here: 0032_manager_role already brought a
-- manager account and user_teams, which is the same idea, so this leans on it
-- rather than building a second one.
--
-- onboarding_status carries no CHECK: SQLite cannot add a constraint to a live
-- column, and rebuilding users a second time to gain one is not worth the risk
-- to every row that points at it.
ALTER TABLE users ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'approved';
CREATE INDEX ix_users_onboarding_status ON users(onboarding_status);

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

CREATE INDEX ix_registration_invites_application_id ON registration_invites(application_id);
