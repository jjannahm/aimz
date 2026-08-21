-- Which league a team is entered in, so it shows in that table before it has
-- played a match.
ALTER TABLE teams ADD COLUMN competition_id TEXT REFERENCES competitions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_teams_competition_id ON teams(competition_id);
