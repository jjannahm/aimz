export type UserRole = "player" | "admin";
export type CompetitionType = "league" | "tournament" | "friendly";
export type MatchStatus = "scheduled" | "live" | "finished";
export type MatchPhase = "not_started" | "first_half" | "halftime" | "second_half" | "extra_time" | "finished";
export type EventType = "goal" | "assist" | "yellow_card" | "red_card" | "substitution";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  player_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface TeamRow {
  id: string;
  name: string;
  squad_code: string | null;
  age_group: string | null;
  season: string | null;
  is_aimz: number;
  is_active: number;
  logo_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompetitionRow {
  id: string;
  name: string;
  season: string;
  type: CompetitionType;
  created_at: string;
  updated_at: string;
}

export interface PlayerRow {
  id: string;
  name: string;
  team_id: string;
  position: string;
  jersey_number: number | null;
  photo_key: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface MatchRow {
  id: string;
  competition_id: string;
  home_team_id: string;
  away_team_id: string;
  kickoff_datetime: string;
  venue: string;
  status: MatchStatus;
  phase: MatchPhase;
  phase_started_at: string | null;
  home_score: number;
  away_score: number;
  revision: number;
  // Structure, not a single total: the live clock needs to know which period is
  // running so it can pause during the break.
  half_length_minutes: number;
  num_halves: number;
  half_time_break_minutes: number;
  // Knockout ties can run two further periods; length is per period.
  has_extra_time: number;
  extra_time_half_length_minutes: number;
  /** How many players start for AIMZ. Null until a lineup is entered. */
  lineup_format: number | null;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  match_id: string;
  type: EventType;
  minute: number | null;
  team_id: string;
  player_id: string | null;
  secondary_player_id: string | null;
  related_event_id: string | null;
  notes: string | null;
  /** Goals only: whether the goal came from a penalty kick. */
  is_penalty: number;
  client_operation_id: string;
  created_at: string;
  updated_at: string;
}

export interface LineupRow {
  id: string;
  match_id: string;
  player_id: string;
  team_id: string;
  is_starter: number;
  position: string | null;
  jersey_number: number | null;
}

export interface StatRow {
  id: string;
  match_id: string;
  player_id: string;
  appeared: number;
  minutes_played: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  created_at: string;
  updated_at: string;
}

export interface InviteRow {
  id: string;
  label: string;
  code_hash: string;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  is_active: number;
  created_by_id: string | null;
  created_at: string;
}

export type JsonObject = Record<string, unknown>;
