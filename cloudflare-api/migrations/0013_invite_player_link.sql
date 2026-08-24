-- Which roster player an invitation is for, so the account created from it
-- knows whose stats to show. Null keeps the old shared-code behaviour.
ALTER TABLE registration_invites ADD COLUMN player_id TEXT REFERENCES players(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_invites_player_id ON registration_invites(player_id);
