import type { components } from '@/src/types/generated';

type Schema = components['schemas'];

export type UserRole = Schema['UserRole'];
export type MatchStatus = Schema['MatchStatus'];
export type MatchPhase = Schema['MatchPhase'];
export type MatchPhaseAction = Schema['MatchPhaseUpdate']['action'];
export type CompetitionType = Schema['CompetitionType'];
export type EventType = Schema['EventType'];
export type User = Schema['UserRead'];
export type TokenResponse = Schema['TokenResponse'];
export type RegistrationInvite = Schema['InviteRead'];
export type PresignResponse = Schema['PresignResponse'];
export type Competition = Schema['CompetitionRead'];
export type StandingRow = Schema['StandingRow'];
export type PlayerMatchStat = Schema['PlayerMatchStatRead'];
export type PlayerSeasonSummary = Schema['PlayerSeasonSummary'];

export type Page<T> = { items: T[]; total: number; limit: number; offset: number };

// Mirrors backend PlayerLeaderRow; move to the generated schema after the next `npm run api:types`.
export type PlayerLeaderRow = {
  rank: number;
  player: Player;
  team: Team;
  goals: number;
  assists: number;
  appearances: number;
};

export type LeaderMetric = 'goals' | 'assists';

export type Team = Omit<Schema['TeamRead'], 'squad_code' | 'age_group' | 'season' | 'logo_key'> & {
  squad_code: string | null;
  age_group: string | null;
  season: string | null;
  logo_key: string | null;
};

export type Player = Omit<Schema['PlayerRead'], 'jersey_number' | 'photo_key'> & {
  jersey_number: number | null;
  photo_key: string | null;
};

export type MatchTimeStructure = Pick<
  Schema['MatchRead'],
  | 'half_length_minutes'
  | 'num_halves'
  | 'half_time_break_minutes'
  | 'has_extra_time'
  | 'extra_time_half_length_minutes'
>;

/** Squads play different formats by age group and competition. */
export const LINEUP_FORMATS = [5, 6, 7, 9, 11] as const;
export type LineupFormat = (typeof LINEUP_FORMATS)[number];

/** Extra time is always two periods, per football convention. */
export const EXTRA_TIME_PERIODS = 2;

export type Match = Omit<Schema['MatchRead'], 'home_team' | 'away_team' | 'competition'> & {
  home_team: Team | null;
  away_team: Team | null;
  competition: Competition | null;
  // Not in the generated schema yet; catches up on the next `npm run api:types`.
  lineup_format: LineupFormat | null;
};

/** (half × halves) + (break × (halves − 1)), plus two extra-time periods when enabled. */
export function totalMatchMinutes(structure: MatchTimeStructure): number {
  const { half_length_minutes, num_halves, half_time_break_minutes } = structure;
  const regulation = half_length_minutes * num_halves + half_time_break_minutes * Math.max(0, num_halves - 1);
  return regulation + (structure.has_extra_time ? EXTRA_TIME_PERIODS * structure.extra_time_half_length_minutes : 0);
}

export type MatchEventExtras = { is_penalty: boolean };

export type MatchEvent = MatchEventExtras & Omit<
  Schema['MatchEventRead'],
  'minute' | 'player_id' | 'secondary_player_id' | 'related_event_id' | 'notes'
> & {
  minute: number | null;
  player_id: string | null;
  secondary_player_id: string | null;
  related_event_id: string | null;
  notes: string | null;
};

export type LineupEntry = Omit<
  Schema['LineupEntryRead'],
  'position' | 'jersey_number'
> & {
  position: string | null;
  jersey_number: number | null;
};

export type LiveMatchSnapshot = Omit<
  Schema['LiveMatchSnapshot'],
  'match' | 'events' | 'lineup'
> & {
  match: Match;
  events: MatchEvent[];
  lineup: LineupEntry[];
};
