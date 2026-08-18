import type { components } from '@/src/types/generated';

type Schema = components['schemas'];

export type UserRole = Schema['UserRole'];
export type MatchStatus = Schema['MatchStatus'];
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

export type Match = Omit<Schema['MatchRead'], 'home_team' | 'away_team' | 'competition'> & {
  home_team: Team | null;
  away_team: Team | null;
  competition: Competition | null;
};

export type MatchEvent = Omit<
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
