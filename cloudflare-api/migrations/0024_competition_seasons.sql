-- A season of a competition is already its own row, kept apart by
-- UNIQUE(name, season). What was missing is a way to say a season is over.
--
-- Existing rows default to active, so every competition already in the
-- database keeps behaving exactly as it did.
ALTER TABLE competitions ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed'));
ALTER TABLE competitions ADD COLUMN completed_at TEXT;
CREATE INDEX IF NOT EXISTS ix_competitions_name ON competitions(name);
