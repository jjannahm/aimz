-- Knockout competitions: a group stage of fours feeding a single-elimination
-- bracket. A null team_count means the competition behaves exactly as before,
-- which is why the format is not a new `type` value: type carries a CHECK
-- constraint, and SQLite cannot alter one without rebuilding the table.
ALTER TABLE competitions ADD COLUMN team_count INTEGER;

CREATE TABLE competition_groups (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (competition_id, position)
);
CREATE INDEX ix_competition_groups_competition_id ON competition_groups(competition_id);

ALTER TABLE teams ADD COLUMN competition_group_id TEXT REFERENCES competition_groups(id) ON DELETE SET NULL;
CREATE INDEX ix_teams_competition_group_id ON teams(competition_group_id);

-- A bracket slot is a fixture that may not have its teams yet, which a matches
-- row cannot be: both team columns there are NOT NULL. `round` is the number of
-- teams still in it — 16, 8, 4, 2 — so rounds sort themselves and the winner of
-- slot p in round r moves to slot p/2 in round r/2.
CREATE TABLE bracket_slots (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  position INTEGER NOT NULL,
  home_team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  away_team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  winner_team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
  UNIQUE (competition_id, round, position)
);
CREATE INDEX ix_bracket_slots_competition_id ON bracket_slots(competition_id, round, position);
