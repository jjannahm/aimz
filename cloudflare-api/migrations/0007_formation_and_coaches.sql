-- Outfield shape per match (digits sum to lineup_format - 1) and the coaching
-- staff per squad, set once rather than re-entered each match.
ALTER TABLE matches ADD COLUMN formation TEXT;
ALTER TABLE teams ADD COLUMN coach TEXT;
ALTER TABLE teams ADD COLUMN assistant_coach TEXT;
