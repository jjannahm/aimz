ALTER TABLE players ADD COLUMN date_of_birth TEXT;
CREATE TABLE player_contacts (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT,
  email TEXT,
  phone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_contacts_player ON player_contacts(player_id);
