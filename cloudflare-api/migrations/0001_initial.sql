PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player', 'admin')),
  player_id TEXT UNIQUE REFERENCES players(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_users_email ON users(email);
CREATE INDEX ix_users_role ON users(role);

CREATE TABLE refresh_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX ix_refresh_user ON refresh_sessions(user_id);
CREATE INDEX ix_refresh_token ON refresh_sessions(token_hash);

CREATE TABLE registration_invites (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_invite_code ON registration_invites(code_hash);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  squad_code TEXT,
  age_group TEXT,
  season TEXT,
  is_aimz INTEGER NOT NULL DEFAULT 0 CHECK (is_aimz IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  logo_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_teams_name ON teams(name);
CREATE INDEX ix_teams_season ON teams(season);

CREATE TABLE competitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  season TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('league', 'tournament', 'friendly')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(name, season)
);
CREATE INDEX ix_competitions_season ON competitions(season);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  position TEXT NOT NULL,
  jersey_number INTEGER CHECK (jersey_number IS NULL OR jersey_number BETWEEN 0 AND 99),
  photo_key TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(team_id, jersey_number)
);
CREATE INDEX ix_players_team ON players(team_id);
CREATE INDEX ix_players_name ON players(name);

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE RESTRICT,
  home_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  away_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  kickoff_datetime TEXT NOT NULL,
  venue TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'finished')),
  home_score INTEGER NOT NULL DEFAULT 0 CHECK (home_score >= 0),
  away_score INTEGER NOT NULL DEFAULT 0 CHECK (away_score >= 0),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(home_team_id <> away_team_id)
);
CREATE INDEX ix_matches_status_kickoff ON matches(status, kickoff_datetime);
CREATE INDEX ix_matches_competition ON matches(competition_id);

CREATE TABLE match_events (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('goal', 'assist', 'yellow_card', 'red_card', 'substitution')),
  minute INTEGER CHECK (minute IS NULL OR minute BETWEEN 0 AND 150),
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  secondary_player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  related_event_id TEXT REFERENCES match_events(id) ON DELETE CASCADE,
  notes TEXT,
  client_operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_events_match_minute ON match_events(match_id, minute);
CREATE INDEX ix_events_player ON match_events(player_id);

CREATE TABLE match_lineup_entries (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  is_starter INTEGER NOT NULL DEFAULT 0 CHECK (is_starter IN (0, 1)),
  position TEXT,
  jersey_number INTEGER CHECK (jersey_number IS NULL OR jersey_number BETWEEN 0 AND 99),
  UNIQUE(match_id, player_id)
);
CREATE INDEX ix_lineup_match ON match_lineup_entries(match_id);

CREATE TABLE player_match_stats (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  appeared INTEGER NOT NULL DEFAULT 0 CHECK (appeared IN (0, 1)),
  minutes_played INTEGER NOT NULL DEFAULT 0 CHECK (minutes_played BETWEEN 0 AND 150),
  goals INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  yellow_cards INTEGER NOT NULL DEFAULT 0,
  red_cards INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(match_id, player_id)
);
CREATE INDEX ix_stats_match ON player_match_stats(match_id);
CREATE INDEX ix_stats_player ON player_match_stats(player_id);
