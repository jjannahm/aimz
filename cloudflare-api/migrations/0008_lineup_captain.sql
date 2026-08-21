-- Which player wears the armband for this match.
ALTER TABLE match_lineup_entries ADD COLUMN is_captain INTEGER NOT NULL DEFAULT 0;
