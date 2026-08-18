CREATE TABLE invite_claims (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES registration_invites(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_invite_claims_invite ON invite_claims(invite_id);
