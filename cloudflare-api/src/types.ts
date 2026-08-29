export type UserRole = "player" | "admin" | "parent";
/** What an invitation creates when it is redeemed. */
export type InviteKind = "player" | "parent";
export type CompetitionType = "league" | "tournament" | "friendly";
export type MatchStatus = "scheduled" | "live" | "finished";
export type MatchPhase = "not_started" | "first_half" | "halftime" | "second_half" | "extra_time" | "finished";
export type EventType = "goal" | "assist" | "own_goal" | "penalty_missed" | "yellow_card" | "red_card" | "substitution";
export type SubstitutionReason = "tactical" | "injury" | "concussion" | "disciplinary" | "other";
export type PenaltyOutcome = "saved" | "off_target";

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
  /** Which badge to draw when no logo is uploaded; null derives it from is_aimz. */
  badge_style: "aimz" | "generated" | null;
  coach: string | null;
  assistant_coach: string | null;
  /** Which league the team is entered in. */
  competition_id: string | null;
  /** Which group of a knockout competition, once the draw is made. */
  competition_group_id: string | null;
  created_at: string;
  updated_at: string;
}

export type CompetitionStatus = "active" | "completed";

export interface CompetitionRow {
  id: string;
  name: string;
  season: string;
  type: CompetitionType;
  /**
   * Whether this season is still being played.
   *
   * A completed season is read-only: its table, results and statistics stand as
   * they were, and nothing may be scored into it until an admin reopens it.
   */
  status: CompetitionStatus;
  completed_at: string | null;
  /**
   * How many teams a knockout competition is drawn for: 8, 16 or 32.
   *
   * Null is the whole of the old behaviour — a league table and nothing else.
   * The format lives here rather than in `type` because `type` carries a CHECK
   * constraint, and SQLite cannot widen one without rebuilding the table.
   */
  team_count: number | null;
  /**
   * How many teams share a group.
   *
   * Null on everything drawn before custom shapes, which were always fours.
   */
  group_size: number | null;
  created_at: string;
  updated_at: string;
}

export interface CompetitionGroupRow {
  id: string;
  competition_id: string;
  name: string;
  position: number;
}

export interface BracketSlotRow {
  id: string;
  competition_id: string;
  /** Teams left in the round: 16, 8, 4, 2. */
  round: number;
  position: number;
  home_team_id: string | null;
  away_team_id: string | null;
  winner_team_id: string | null;
  match_id: string | null;
}

export interface PlayerRow {
  id: string;
  name: string;
  team_id: string;
  position: string;
  jersey_number: number | null;
  photo_key: string | null;
  date_of_birth: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface TrainingRow {
  id: string;
  team_id: string;
  starts_at: string;
  duration_minutes: number;
  venue: string;
  notes: string | null;
  series_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityRow {
  id: string;
  training_session_id: string;
  player_id: string;
  status: "going" | "maybe" | "not_going";
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssignmentRow {
  id: string;
  match_id: string | null;
  training_session_id: string | null;
  title: string;
  assigned_player_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementRow {
  id: string;
  team_id: string | null;
  title: string;
  body: string;
  author_id: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export interface PlayerContactRow {
  id: string;
  player_id: string;
  name: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
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
  /** Outfield shape, e.g. "4-4-2"; digits sum to lineup_format - 1. */
  formation: string | null;
  /** Picked by an admin once the match is finished, not voted for. */
  man_of_the_match_player_id: string | null;
  /** Set when the award went to the other side, who have no player record here. */
  man_of_the_match_is_opponent: number;
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
  /** Substitutions only: why the player came off. */
  substitution_reason: SubstitutionReason | null;
  /** Missed penalties only: saved by the keeper, or off target. */
  penalty_outcome: PenaltyOutcome | null;
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
  is_captain: number;
  position: string | null;
  jersey_number: number | null;
}

export interface StatRow {
  id: string;
  match_id: string;
  player_id: string;
  /**
   * The squad she turned out for, stamped when the statistic is saved.
   *
   * Not read from `players.team_id`: that is where she is *now*, so promoting
   * someone an age group would otherwise carry last season's record with her.
   * Null only on rows that predate this column and had no lineup to recover it
   * from — unknown, rather than attributed to the wrong squad.
   */
  team_id: string | null;
  appeared: number;
  minutes_played: number;
  goals: number;
  assists: number;
  /** Kept apart from goals so an own goal never inflates a scoring record. */
  own_goals: number;
  yellow_cards: number;
  red_cards: number;
  /** Goalkeeping, and zero for everyone who was not in goal. */
  goals_conceded: number;
  penalties_saved: number;
  /** A flag, not a count: one match, one clean sheet at most. */
  clean_sheet: number;
  created_at: string;
  updated_at: string;
}

export interface InviteRow {
  id: string;
  label: string;
  code_hash: string;
  /** What redeeming this creates: one player, or a parent of several. */
  kind: InviteKind;
  /** Kept for invitations written before `invite_players`; read that instead. */
  player_id: string | null;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  is_active: number;
  created_by_id: string | null;
  created_at: string;
}

export interface StandingAccumulator {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  points: number;
}

/** One player's season, totalled across a competition's finished matches. */
export interface AwardTotals {
  player_id: string;
  /** The squad the award was earned with, not the one she is on today. */
  team_id: string | null;
  motm: number;
  goals: number;
  assists: number;
  minutes: number;
  cards: number;
  appearances: number;
}

export interface AuditRow {
  id: string;
  actor_id: string | null;
  /** Kept alongside the id so a removed admin's actions still read. */
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  match_id: string | null;
  summary: string;
  created_at: string;
}

export type JsonObject = Record<string, unknown>;
