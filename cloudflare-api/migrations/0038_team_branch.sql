-- The academy operates squads at several physical branches. Existing squads
-- remain valid and are grouped as "Branch not set" until an admin edits them.
ALTER TABLE teams ADD COLUMN branch TEXT;
CREATE INDEX ix_teams_branch ON teams(branch);
