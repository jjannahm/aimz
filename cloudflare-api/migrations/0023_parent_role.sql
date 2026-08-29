-- A parent account has existed in the code since 0019 — an invitation naming
-- several children, a user_children row for each, a role of its own — but never
-- in the database. users.role has carried CHECK (role IN ('player', 'admin'))
-- since 0001 and no migration since has widened it, so every parent
-- registration failed on the constraint and the whole feature was unreachable.
-- Nothing caught it because no test had ever registered a parent.
--
-- SQLite cannot alter a CHECK constraint, so users is rebuilt the way 0010
-- rebuilt match_events.
--
-- The care is in what DROP TABLE does on the way out. As 0010 notes, it performs
-- an implicit DELETE FROM, and that fires every foreign key action aimed at
-- users: user_children and refresh_sessions would CASCADE away — user_children
-- being the parent-to-child links this migration exists to make usable — and
-- created_by_id, author_id and actor_id would each be SET NULL, quietly erasing
-- who wrote what. So everything at risk is copied aside first and put back after.
--
-- The restores are deliberately written to be correct whether or not those
-- actions actually fire, because that depends on whether foreign keys are
-- enforced while the migration runs: INSERT OR IGNORE re-adds only rows that
-- actually went, and each UPDATE touches only a column that came back NULL. If
-- the rows look untouched when you read this, that is the safeguard working —
-- not evidence it can be deleted.

CREATE TABLE user_children_backup AS SELECT * FROM user_children;
CREATE TABLE refresh_sessions_backup AS SELECT * FROM refresh_sessions;
CREATE TABLE invite_author_backup AS SELECT id, created_by_id FROM registration_invites WHERE created_by_id IS NOT NULL;
CREATE TABLE announcement_author_backup AS SELECT id, author_id FROM announcements WHERE author_id IS NOT NULL;
CREATE TABLE audit_actor_backup AS SELECT id, actor_id FROM audit_log WHERE actor_id IS NOT NULL;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player', 'admin', 'parent')),
  player_id TEXT UNIQUE REFERENCES players(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO users_new (id, name, email, password_hash, role, player_id, is_active, created_at, updated_at)
SELECT id, name, email, password_hash, role, player_id, is_active, created_at, updated_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX ix_users_email ON users(email);
CREATE INDEX ix_users_role ON users(role);

INSERT OR IGNORE INTO user_children (user_id, player_id, created_at)
  SELECT user_id, player_id, created_at FROM user_children_backup;
INSERT OR IGNORE INTO refresh_sessions (id, user_id, token_hash, expires_at, created_at, revoked_at)
  SELECT id, user_id, token_hash, expires_at, created_at, revoked_at FROM refresh_sessions_backup;

UPDATE registration_invites SET created_by_id = (SELECT created_by_id FROM invite_author_backup WHERE invite_author_backup.id = registration_invites.id)
  WHERE created_by_id IS NULL AND id IN (SELECT id FROM invite_author_backup);
UPDATE announcements SET author_id = (SELECT author_id FROM announcement_author_backup WHERE announcement_author_backup.id = announcements.id)
  WHERE author_id IS NULL AND id IN (SELECT id FROM announcement_author_backup);
UPDATE audit_log SET actor_id = (SELECT actor_id FROM audit_actor_backup WHERE audit_actor_backup.id = audit_log.id)
  WHERE actor_id IS NULL AND id IN (SELECT id FROM audit_actor_backup);

DROP TABLE user_children_backup;
DROP TABLE refresh_sessions_backup;
DROP TABLE invite_author_backup;
DROP TABLE announcement_author_backup;
DROP TABLE audit_actor_backup;
