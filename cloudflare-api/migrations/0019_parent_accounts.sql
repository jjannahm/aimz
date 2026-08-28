-- Parent accounts.
--
-- A player account links to exactly one roster player, which `users.player_id`
-- already carries as a unique column. A parent may have several children in the
-- academy, so that one-to-one cannot be widened in place: the children hang off
-- a join table instead, and `users.player_id` stays as it is for players.
--
-- An invitation now says which of the two it creates, and carries its players
-- the same way for both, so one code path redeems either.

ALTER TABLE registration_invites ADD COLUMN kind TEXT NOT NULL DEFAULT 'player';

CREATE TABLE invite_players (
  invite_id TEXT NOT NULL REFERENCES registration_invites(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (invite_id, player_id)
);

CREATE INDEX ix_invite_players_invite ON invite_players(invite_id);

CREATE TABLE user_children (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, player_id)
);

CREATE INDEX ix_user_children_user ON user_children(user_id);

-- Invitations written before this migration named their player in a column of
-- their own. Carry those across so the redemption path only reads one place.
INSERT OR IGNORE INTO invite_players (invite_id, player_id)
  SELECT id, player_id FROM registration_invites WHERE player_id IS NOT NULL;
