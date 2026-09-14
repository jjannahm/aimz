CREATE TABLE refresh_families (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT
);

ALTER TABLE refresh_sessions ADD COLUMN family_id TEXT REFERENCES refresh_families(id) ON DELETE CASCADE;
ALTER TABLE refresh_sessions ADD COLUMN revocation_reason TEXT;
ALTER TABLE refresh_sessions ADD COLUMN replaced_by_session_id TEXT;

UPDATE refresh_sessions
SET revoked_at = COALESCE(revoked_at, datetime('now')),
    revocation_reason = COALESCE(revocation_reason, 'security_upgrade');

CREATE INDEX ix_refresh_families_user ON refresh_families(user_id);
CREATE INDEX ix_refresh_sessions_family ON refresh_sessions(family_id);
