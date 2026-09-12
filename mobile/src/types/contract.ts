/**
 * The JSON contract shared by the AIMZ mobile client and Cloudflare Worker.
 *
 * Keep this file dependency-free: the Worker imports these types to prove its
 * serializers produce the same shapes the app consumes.
 */
export type UserRole = 'player' | 'parent' | 'coach' | 'admin';
export type MatchStatus = 'scheduled' | 'live' | 'finished';
export type MatchPhase = 'not_started' | 'first_half' | 'halftime' | 'second_half' | 'extra_time' | 'finished';
export type MatchPhaseAction = 'start_match' | 'halftime' | 'start_second_half' | 'start_extra_time' | 'finish_match';
export type CompetitionType = 'league' | 'tournament' | 'friendly';
export type EventType = 'goal' | 'assist' | 'own_goal' | 'penalty_missed' | 'yellow_card' | 'red_card' | 'substitution';
export type SubstitutionReason = 'tactical' | 'injury' | 'concussion' | 'disciplinary' | 'other';
export type PenaltyOutcome = 'saved' | 'off_target';

export interface UserRead {
  id: string; name: string; email: string; role: UserRole; player_id: string | null;
  onboarding_status: 'pending' | 'approved' | 'declined'; expires_at: string | null; created_at: string;
}

export interface TokenResponse {
  access_token: string; refresh_token: string; token_type: 'bearer'; expires_in: number; user: UserRead;
}

export interface InviteRead {
  id: string; label: string; kind: 'player' | 'parent' | 'coach' | 'newcomer'; player_id: string | null;
  team_id: string | null; application_id: string | null; expires_at: string | null; max_uses: number | null;
  use_count: number; is_active: boolean; created_at: string;
}

export interface PresignResponse {
  upload_url: string; fields: Record<string, string>; object_key: string; expires_in: number;
}

export interface CompetitionRead {
  id: string; name: string; season: string; type: CompetitionType; status: 'active' | 'completed';
  completed_at: string | null; team_count: number | null; group_size: number | null;
  created_at: string; updated_at: string;
}

export interface TeamRead {
  id: string; name: string; branch?: string | null; squad_code: string | null; age_group: string | null;
  season: string | null; is_aimz: boolean; is_active: boolean; logo_key: string | null;
  logo_url?: string | null; badge_style: 'aimz' | 'generated' | null; coach: string | null;
  assistant_coach: string | null; competition_id: string | null; competition_group_id: string | null;
  created_at: string; updated_at: string;
}

export interface PlayerRead {
  id: string; name: string; team_id: string; position: string; jersey_number: number | null;
  photo_key: string | null; photo_url: string | null; is_active: boolean; age?: number | null;
  created_at: string; updated_at: string;
}

export interface MatchRead {
  id: string; competition_id: string; home_team_id: string; away_team_id: string;
  kickoff_datetime: string; venue: string; status: MatchStatus; phase: MatchPhase;
  phase_started_at: string | null; home_score: number; away_score: number; revision: number;
  half_length_minutes: number; num_halves: number; half_time_break_minutes: number;
  has_extra_time: boolean; extra_time_half_length_minutes: number; lineup_format: number | null;
  formation: string | null; man_of_the_match_player_id: string | null; man_of_the_match_is_opponent: boolean;
  created_at: string; updated_at: string; home_team: TeamRead | null; away_team: TeamRead | null;
  competition: CompetitionRead | null;
}

export interface MatchEventRead {
  id: string; match_id: string; type: EventType; minute: number | null; team_id: string;
  player_id: string | null; secondary_player_id: string | null; related_event_id: string | null;
  notes: string | null; is_penalty: boolean; substitution_reason: SubstitutionReason | null;
  penalty_outcome: PenaltyOutcome | null; client_operation_id: string; created_at: string; updated_at: string;
}

export interface LineupEntryRead {
  id: string; match_id: string; player_id: string; team_id: string; is_starter: boolean;
  is_captain: boolean; position: string | null; jersey_number: number | null;
}

export interface PlayerMatchStatRead {
  id: string; match_id: string; player_id: string; team_id: string | null; appeared: boolean;
  minutes_played: number; goals: number; assists: number; own_goals: number; yellow_cards: number;
  red_cards: number; goals_conceded: number; penalties_saved: number; clean_sheet: boolean;
  created_at: string; updated_at: string;
}

export interface PlayerSeasonSummary {
  player: PlayerRead; season: string | null; appearances: number; minutes_played: number; goals: number;
  assists: number; own_goals: number; yellow_cards: number; red_cards: number; matches: PlayerMatchStatRead[];
}

export interface StandingRow {
  rank: number; team: TeamRead; form: string[]; played: number; won: number; drawn: number;
  lost: number; goals_for: number; goals_against: number; goal_difference: number; points: number;
}

export interface LiveMatchSnapshot {
  match: MatchRead; events: MatchEventRead[]; lineup: LineupEntryRead[]; revision: number;
}
