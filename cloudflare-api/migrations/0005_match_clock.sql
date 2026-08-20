-- Add the operator-controlled live match clock after the extra-time migration.
ALTER TABLE matches ADD COLUMN phase TEXT NOT NULL DEFAULT 'not_started'
  CHECK (phase IN ('not_started', 'first_half', 'halftime', 'second_half', 'extra_time', 'finished'));
ALTER TABLE matches ADD COLUMN phase_started_at TEXT;

UPDATE matches
SET phase = CASE
    WHEN status = 'live' THEN 'first_half'
    WHEN status = 'finished' THEN 'finished'
    ELSE 'not_started'
  END,
  phase_started_at = CASE
    WHEN status = 'live' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ELSE NULL
  END;

CREATE INDEX ix_matches_phase ON matches(phase);
