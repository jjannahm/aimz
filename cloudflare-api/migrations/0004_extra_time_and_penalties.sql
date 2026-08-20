-- Optional extra time for knockout ties, and a penalty flag on goals.
ALTER TABLE matches ADD COLUMN has_extra_time INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN extra_time_half_length_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE match_events ADD COLUMN is_penalty INTEGER NOT NULL DEFAULT 0;
