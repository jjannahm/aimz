-- What a goalkeeper is answerable for, alongside the outfield tallies already
-- kept per match. Clean sheet is a flag rather than a count because a keeper
-- can only keep one per match, and it is only settled once the match is over.
ALTER TABLE player_match_stats ADD COLUMN goals_conceded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_match_stats ADD COLUMN penalties_saved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_match_stats ADD COLUMN clean_sheet INTEGER NOT NULL DEFAULT 0;

-- An opponent can be named man of the match without having a player record, so
-- the award is either one of our players or, failing that, simply the away side.
ALTER TABLE matches ADD COLUMN man_of_the_match_is_opponent INTEGER NOT NULL DEFAULT 0;
