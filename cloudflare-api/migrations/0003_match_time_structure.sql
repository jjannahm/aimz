-- Store each match's period structure so the live clock can tell which period is
-- running and pause the displayed minute during the break.
ALTER TABLE matches ADD COLUMN half_length_minutes INTEGER NOT NULL DEFAULT 45;
ALTER TABLE matches ADD COLUMN num_halves INTEGER NOT NULL DEFAULT 2;
ALTER TABLE matches ADD COLUMN half_time_break_minutes INTEGER NOT NULL DEFAULT 15;
