-- A manager account: somebody who runs one squad rather than the academy.
--
-- Three roles have existed until now — player, admin, parent — and the word
-- "coach" in the schema is a name printed on a team sheet, not an account. A
-- manager is an account, with the admin's Manage screen held to the squads
-- assigned to them.
--
-- users.role carries a CHECK, and SQLite cannot alter one, so the table is
-- rebuilt the way 0023 rebuilt it to admit 'parent'. That migration's warning
-- applies unchanged and is the reason for the backups below: DROP TABLE
-- performs an implicit DELETE FROM, which fires every foreign key aimed at
-- users. user_children, refresh_sessions and account_expiry would CASCADE
-- away, and created_by_id, author_id and actor_id would each be SET NULL,
-- quietly erasing who wrote what. Everything at risk is copied aside first and put
-- back after, written to be correct whether or not those actions actually fire
-- — INSERT OR IGNORE re-adds only rows that went, and each UPDATE touches only
-- a column that came back NULL.
--
-- Unlike 0023 the new table is created under its own name rather than renamed
-- into place, so this migration performs no ALTER TABLE.

CREATE TABLE users_backup AS SELECT * FROM users;
CREATE TABLE user_children_backup AS SELECT * FROM user_children;
CREATE TABLE refresh_sessions_backup AS SELECT * FROM refresh_sessions;
CREATE TABLE account_expiry_backup AS SELECT * FROM account_expiry;
CREATE TABLE invite_author_backup AS SELECT id, created_by_id FROM registration_invites WHERE created_by_id IS NOT NULL;
CREATE TABLE announcement_author_backup AS SELECT id, author_id FROM announcements WHERE author_id IS NOT NULL;
CREATE TABLE audit_actor_backup AS SELECT id, actor_id FROM audit_log WHERE actor_id IS NOT NULL;

DROP TABLE users;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player', 'admin', 'parent', 'manager')),
  player_id TEXT UNIQUE REFERENCES players(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO users (id, name, email, password_hash, role, player_id, is_active, created_at, updated_at)
SELECT id, name, email, password_hash, role, player_id, is_active, created_at, updated_at FROM users_backup;

CREATE INDEX ix_users_email ON users(email);
CREATE INDEX ix_users_role ON users(role);

INSERT OR IGNORE INTO user_children (user_id, player_id, created_at)
  SELECT user_id, player_id, created_at FROM user_children_backup;
INSERT OR IGNORE INTO refresh_sessions (id, user_id, token_hash, expires_at, created_at, revoked_at)
  SELECT id, user_id, token_hash, expires_at, created_at, revoked_at FROM refresh_sessions_backup;
INSERT OR IGNORE INTO account_expiry (user_id, expires_at, created_at, updated_at)
  SELECT user_id, expires_at, created_at, updated_at FROM account_expiry_backup;

UPDATE registration_invites SET created_by_id = (SELECT created_by_id FROM invite_author_backup WHERE invite_author_backup.id = registration_invites.id)
  WHERE created_by_id IS NULL AND id IN (SELECT id FROM invite_author_backup);
UPDATE announcements SET author_id = (SELECT author_id FROM announcement_author_backup WHERE announcement_author_backup.id = announcements.id)
  WHERE author_id IS NULL AND id IN (SELECT id FROM announcement_author_backup);
UPDATE audit_log SET actor_id = (SELECT actor_id FROM audit_actor_backup WHERE audit_actor_backup.id = audit_log.id)
  WHERE actor_id IS NULL AND id IN (SELECT id FROM audit_actor_backup);

DROP TABLE users_backup;
DROP TABLE user_children_backup;
DROP TABLE refresh_sessions_backup;
DROP TABLE account_expiry_backup;
DROP TABLE invite_author_backup;
DROP TABLE announcement_author_backup;
DROP TABLE audit_actor_backup;

-- Which squads a manager runs. A list rather than a column because a coach at
-- a small academy takes two age groups as often as one, and because the same
-- shape already answers a parent with children on two squads.
CREATE TABLE user_teams (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, team_id)
);
CREATE INDEX ix_user_teams_user ON user_teams(user_id);
CREATE INDEX ix_user_teams_team ON user_teams(team_id);

-- A manager invitation names squads rather than players, so it needs a link
-- table of its own alongside invite_players.
CREATE TABLE invite_teams (
  invite_id TEXT NOT NULL REFERENCES registration_invites(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (invite_id, team_id)
);
CREATE INDEX ix_invite_teams_invite ON invite_teams(invite_id);
