-- How many players start for AIMZ. Null until a lineup is entered; squads play
-- 5-, 6-, 7-, 9- and 11-a-side.
ALTER TABLE matches ADD COLUMN lineup_format INTEGER;
