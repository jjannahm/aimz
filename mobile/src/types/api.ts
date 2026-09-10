import type { components } from '@/src/types/generated';

type Schema = components['schemas'];

// The generated union comes from an API without parent accounts; catches up on
// the next `npm run api:types`.
export type UserRole = Schema['UserRole'] | 'parent' | 'manager';
/**
 * `expires_at` is when an account stops working, or null for one that never
 * does. `team_ids` are the squads it is attached to — a player's own, a
 * parent's children's, a manager's assigned — or null for an administrator,
 * who is attached to none because they may open all of them. Only
 * `GET /users/me` carries it; a session's own copy of the user does not.
 */
export type User = Omit<Schema['UserRead'], 'role'> & { role: UserRole; expires_at?: string | null; team_ids?: string[] | null };
/**
 * A private, renewable calendar subscription for one player or family.
 *
 * `url` is null when there is no feed: reading no longer mints one, so an
 * account that has never asked — or has removed the one it had — genuinely has
 * no address to hand out.
 */
export type CalendarFeed = { url: string | null; subscribed_at: string | null };
/** What redeeming an invitation creates: one player, or a parent of several. */
export type InviteKind = 'player' | 'parent' | 'manager';
/** A roster player an account speaks for: itself for a player, a child for a parent. */
export type LinkedChild = { id: string; name: string; team_id: string; team_name: string | null };
export type MatchStatus = Schema['MatchStatus'];
export type MatchPhase = Schema['MatchPhase'];
export type MatchPhaseAction = Schema['MatchPhaseUpdate']['action'];
export type CompetitionType = Schema['CompetitionType'];
// The generated union predates own goals and missed penalties; catches up on
// the next `npm run api:types`.
export type EventType = Schema['EventType'] | ExtraEventType;
export type TokenResponse = Schema['TokenResponse'];
export type RegistrationInvite = Schema['InviteRead'] & { player_id: string | null; kind: InviteKind; players?: { id: string; name: string }[] };
export type PresignResponse = Schema['PresignResponse'];
// Not in the generated schema yet; catches up on the next `npm run api:types`.
/** 8, 16 or 32 for a knockout; null for a competition that is only a table. */
/** A closed season is read-only; the API refuses to score into one. */
export type CompetitionStatus = 'active' | 'completed';
// Not in the generated schema yet; catches up on the next `npm run api:types`.
// Optional so a response cached before seasons could be closed still types.
export type Competition = Schema['CompetitionRead'] & { team_count: number | null; group_size: number | null; status?: CompetitionStatus; completed_at?: string | null };

/** Seasons of one competition, newest first, and which of them is open. */
export function seasonsOf(competitions: Competition[], name: string): Competition[] {
  return competitions.filter((item) => item.name === name).sort((a, b) => b.season.localeCompare(a.season));
}

/** Every season on record, newest first. */
export function allSeasons(competitions: Competition[]): string[] {
  return [...new Set(competitions.map((item) => item.season))].sort((a, b) => b.localeCompare(a));
}

/**
 * The season to open on: the newest that still has something being played,
 * falling back to the newest on record when every one of them has ended.
 */
export function currentSeason(competitions: Competition[]): string | null {
  const seasons = allSeasons(competitions);
  const open = seasons.find((season) => competitions.some((item) => item.season === season && item.status !== 'completed'));
  return open ?? seasons[0] ?? null;
}
export const KNOCKOUT_TEAM_COUNTS = [8, 16, 32] as const;
/** Two from each group go through, which is what settles the bracket's size. */
export const ADVANCE_PER_GROUP = 2;
const isPowerOfTwo = (value: number) => Number.isInteger(value) && value >= 1 && (value & (value - 1)) === 0;

/**
 * What is wrong with a custom draw, or null when nothing is.
 *
 * The same rules the API enforces, checked here so the admin reads them while
 * typing rather than after saving. A bracket halves or it does not exist, so
 * the number of groups has to be a power of two: six groups send twelve teams
 * through, and twelve teams have no bracket without byes.
 */
export function describeCustomDraw(groupCount: number, groupSize: number): string | null {
  if (!Number.isInteger(groupCount) || groupCount < 2) return 'Enter at least 2 groups.';
  if (!Number.isInteger(groupSize) || groupSize < 2) return 'A group holds at least 2 teams.';
  if (!isPowerOfTwo(groupCount)) {
    return `${groupCount} groups send ${groupCount * ADVANCE_PER_GROUP} teams through, which is not a bracket. Use 2, 4, 8 or 16 groups.`;
  }
  return null;
}
/** Every group is a four, which is where the 8/16/32 sizes come from. */
export const GROUP_SIZE = 4;
export type KnockoutTeamCount = (typeof KNOCKOUT_TEAM_COUNTS)[number];
export const isKnockout = (competition: Pick<Competition, 'team_count'> | null | undefined): boolean => competition?.team_count != null;

export type CompetitionGroupRef = { id: string; name: string; position: number };
/** `group` is null on a league row, and on a knockout team not yet drawn. */
export type StandingRow = Omit<Schema['StandingRow'], 'team'> & { team: Team; form: FormResult[]; group?: CompetitionGroupRef | null };

export type CompetitionGroup = CompetitionGroupRef & { competition_id: string; teams: Team[] };

export type BracketSlot = {
  id: string;
  /** Teams left in the round: 16, 8, 4, 2. */
  round: number;
  position: number;
  home_team: Team | null;
  away_team: Team | null;
  winner_team_id: string | null;
  match_id: string | null;
};
export type BracketRound = { round: number; label: string; slots: BracketSlot[] };
export type Bracket = { competition_id: string; team_count: number | null; rounds: BracketRound[] };
export type PlayerMatchStat = Schema['PlayerMatchStatRead'];
// Not in the generated schema yet; catches up on the next `npm run api:types`.
// Optional so a response cached before the goalkeeping fields existed still
// types, and the app reads them through a zero.
export type GoalkeeperTotals = { goals_conceded?: number; penalties_saved?: number; clean_sheets?: number };

/** What a player reached, and when. */
export type Milestone = { id: string; label: string; kickoff_datetime: string; match_id: string };
/** A run still going as of her last match. */
export type Streak = { id: string; label: string; count: number };
/** The next mark on a track she is already on: "2 more appearances to 50". */
export type NextMilestone = { id: string; label: string; current: number; target: number; remaining: number };
export type MilestoneSummary = { reached: Milestone[]; streaks: Streak[]; next: NextMilestone[] };

/**
 * One match on a player's record, with its match joined in.
 *
 * `team` is the squad she turned out for that day, which is not necessarily the
 * squad she is on now — that is the whole point of it being on the statistic.
 */
export type PlayerMatchLine = PlayerMatchStat & GoalkeeperTotals & {
  kickoff_datetime: string;
  competition: { id: string; name: string; season: string };
  team: Team | null;
  opponent: Team | null;
  man_of_the_match: boolean;
};

export type PlayerSeasonSummary = Omit<Schema['PlayerSeasonSummary'], 'matches'> & GoalkeeperTotals & {
  /** Every season she has a record in, newest first. */
  seasons: string[];
  trainings_attended: number;
  trainings_expected: number;
  /** Null when no register has ever named her, rather than a misleading zero. */
  training_attendance_pct: number | null;
  milestones: MilestoneSummary;
  matches: PlayerMatchLine[];
};

/** One thing a player has won, and whether the season it came from is settled. */
export type Honour = {
  competition: Competition;
  metric: AwardMetric;
  label: string;
  value: number;
  unit: string;
  team: Team | null;
  /** False while the competition still has matches to play. */
  is_final: boolean;
};
export type PlayerHonours = { player: Player; honours: Honour[] };

export type Page<T> = { items: T[]; total: number; limit: number; offset: number };

/**
 * One registered account, as an administrator sees it.
 *
 * `player` and `team` come from `users.player_id`, which only a player account
 * uses. A parent reaches the roster through `children` instead, and reads as
 * `player: null` however many children they speak for — so the two must be told
 * apart before an empty `player` is called a broken link.
 */
export type AdminAccount = User & { player: Player | null; team: Team | null; children: LinkedChild[] };

export type TrainingSession = {
  id: string;
  team_id: string;
  team: Team;
  starts_at: string;
  duration_minutes: number;
  venue: string;
  notes: string | null;
  series_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Announcement = {
  id: string;
  team_id: string | null;
  team: Team | null;
  title: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type AvailabilityStatus = 'going' | 'not_going';

/** Whether a player turned up, or null while nobody has said either way. */
/**
 * What the register can say. Late counts as having turned up wherever a
 * percentage is worked out, and is counted on its own wherever a figure is
 * shown, so the attendance number stays honest and the lateness stays visible.
 */
export type AttendanceStatus = 'present' | 'late' | 'absent';

/** Where a request to correct a register has got to. */
export type AttendanceRequestStatus = 'pending' | 'approved' | 'rejected';

/**
 * A request to correct one player's mark at one session.
 *
 * `current_status` is what the register said when it was raised, which is not
 * necessarily what it says now: a coach reading this a week later needs to
 * know what it was answering.
 */
export type AttendanceRequest = {
  id: string;
  training_session_id: string;
  player_id: string;
  current_status: AttendanceStatus | null;
  requested_status: AttendanceStatus;
  reason: string | null;
  status: AttendanceRequestStatus;
  decided_at: string | null;
  decision_reason: string | null;
  created_at: string;
  player: Player | null;
  session: { id: string; starts_at: string; venue: string; team_id: string } | null;
};

/** One thing a coach records about how a player trained. */
export type TrainingMetric = {
  id: string;
  key: string;
  label: string;
  /** A rating is a judgement on a scale; a count is a quantity. */
  kind: 'rating' | 'count';
  min_value: number | null;
  max_value: number | null;
  unit: string | null;
  sort_order: number;
  is_active: boolean;
};

/** One squad's readings for one session, keyed by metric id. */
export type TrainingPerformance = {
  metrics: TrainingMetric[];
  items: { player: Player; values: Record<string, number> }[];
};

/** A player's training record: what they attended and how they were marked. */
export type PlayerTrainingStats = {
  player: Player;
  metrics: TrainingMetric[];
  /** `team_pct` is the whole squad's ratio, for this player to be read against. */
  attendance: { attended: number; late: number; expected: number; pct: number | null; team_pct: number | null };
  totals: { metric: TrainingMetric; value: number | null; sessions: number }[];
  sessions: { id: string; starts_at: string; venue: string; status: 'present' | 'absent' | null; values: Record<string, number> }[];
};

/** What a report says, as it stood when it was published. */
export type ReportSnapshot = {
  /** Two adds the training marks; one is a report published before them. */
  version: 1 | 2;
  player: { name: string; team_name: string | null; position: string | null; jersey_number: number | null };
  /** `late` arrives with report snapshot version 3; an older one has none. */
  attendance: { attended: number; expected: number; pct: number | null; late?: number };
  /** How the player was marked at training. Absent on a version-one report. */
  training?: { key: string; label: string; kind: 'rating' | 'count'; max_value: number | null; value: number; sessions: number }[];
  /** Marks the player has that fall outside the period this report covers. */
  marks_outside?: { sessions: number; first: string; last: string } | null;
  matches: { appearances: number; minutes: number; goals: number; assists: number; yellow_cards: number; red_cards: number };
  fees: { charged_piastres: number; paid_piastres: number; outstanding_piastres: number; overdue: number };
  generated_at: string;
};

/** A report as its author sees it. */
export type PlayerReport = {
  id: string;
  player_id: string;
  player: Player | null;
  team_id: string;
  team: Team | null;
  title: string;
  period_start: string;
  period_end: string;
  coach_feedback: string;
  status: 'draft' | 'published';
  snapshot: ReportSnapshot;
  /** 'live' while a draft, 'frozen' once published. */
  snapshot_source: 'live' | 'frozen';
  share_token: string | null;
  published_at: string | null;
  published_by_name: string | null;
  first_opened_at: string | null;
};

/** What the link hands to whoever opens it: no identifiers of any kind. */
export type SharedReport = {
  title: string;
  period_start: string;
  period_end: string;
  coach_feedback: string;
  published_at: string | null;
  published_by_name: string | null;
  snapshot: ReportSnapshot | null;
};

/** Where a charge stands. Worked out by the server on every read. */
export type FeeStatus = 'void' | 'paid' | 'partial' | 'overdue' | 'unpaid';
export type PaymentMethod = 'cash' | 'instapay' | 'bank_transfer' | 'other';

/** A recurring monthly amount for one squad. Money is whole piastres. */
export type FeePlan = {
  id: string;
  team_id: string;
  team: Team | null;
  label: string;
  amount_piastres: number;
  due_day: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type FeePayment = {
  id: string;
  fee_charge_id: string;
  amount_piastres: number;
  paid_on: string;
  method: PaymentMethod;
  note: string | null;
  recorded_by_name: string;
  created_at: string;
};

/** One amount owed by one player, monthly or one-off. */
export type FeeCharge = {
  id: string;
  player_id: string;
  player: Player | null;
  team_id: string;
  fee_plan_id: string | null;
  period: string | null;
  label: string;
  amount_piastres: number;
  paid_piastres: number;
  outstanding_piastres: number;
  status: FeeStatus;
  due_on: string;
  voided_at: string | null;
  void_reason: string | null;
  /** Only on a single charge read, not in a list. */
  payments?: FeePayment[];
};

/** One squad's ledger: the totals, and a line per player. */
export type FeeSummary = {
  team: Team | null;
  period: string | null;
  totals: {
    charged_piastres: number;
    paid_piastres: number;
    outstanding_piastres: number;
    players_total: number;
    players_paid: number;
    players_overdue: number;
    players_outstanding: number;
  };
  players: {
    player: Player | null;
    charged_piastres: number;
    paid_piastres: number;
    outstanding_piastres: number;
    status: FeeStatus;
  }[];
};

/** What generating a month reports back. */
export type FeeGeneration = { period: string; created: number; skipped: number; squad_size: number };
export type AttendanceMark = { player: Player; status: AttendanceStatus | null; marked_at: string | null };
/** One session's register, with the tallies worked out server-side. */
export type TrainingRegister = { items: AttendanceMark[]; present: number; late: number; absent: number; unmarked: number };
export type TrainingAvailability = {
  id: string;
  training_session_id: string;
  player_id: string;
  player: Player;
  status: AvailabilityStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type EventAssignment = {
  id: string;
  match_id: string | null;
  training_session_id: string | null;
  title: string;
  assigned_player_id: string | null;
  assigned_player: Player | null;
  created_at: string;
  updated_at: string;
};

export type PlayerContact = {
  id: string;
  player_id: string;
  name: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export type PlayerRosterDetails = { player_id: string; date_of_birth: string | null; contacts: PlayerContact[] };

/**
 * What the academy holds about who a player is.
 *
 * Gathered from the records that already exist — the roster record, the
 * contacts, and the account where she has one — rather than a profile table of
 * its own. A field the app does not collect yet simply is not here.
 */
export type PlayerPersonalDetails = {
  player: Player | null;
  team: Team | null;
  date_of_birth: string | null;
  age: number | null;
  account: { name: string; email: string } | null;
  contacts: PlayerContact[];
};

/** One charge on a family's record, with what has been paid against it. */
export type PlayerFeeCharge = FeeCharge & { payments: FeePayment[] };

/**
 * A family's money, as a view of the academy's ledger. Voided charges are
 * listed and excluded from every total.
 */
export type PlayerFinancials = {
  player: Player | null;
  summary: { charged_piastres: number; paid_piastres: number; outstanding_piastres: number; overdue: number };
  items: PlayerFeeCharge[];
};

// Mirrors backend PlayerLeaderRow; move to the generated schema after the next `npm run api:types`.
export type PlayerLeaderRow = {
  rank: number;
  player: Player;
  team: Team;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  appearances: number;
};

/** A five-match strip, newest first. */
export type FormResult = 'W' | 'D' | 'L';

export type HeadToHeadMeeting = {
  match_id: string;
  kickoff_datetime: string;
  competition: Competition | null;
  home_team: Team | null;
  away_team: Team | null;
  home_score: number;
  away_score: number;
  result: FormResult;
};

/** One squad member's season totals, aggregated by the API in a single query. */
export type SquadStat = {
  player_id: string;
  appearances: number;
  minutes_played: number;
  goals: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
};

export type HeadToHead = {
  team: Team;
  opponent: Team;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  meetings: HeadToHeadMeeting[];
};

export type AwardMetric = 'motm' | 'goals' | 'assists' | 'appearances' | 'minutes' | 'discipline';

/** The metric, not the label, keys the ranking behind an award. */
export type PlayerAward = { metric: AwardMetric; label: string; player: Player; team: Team; value: number; unit: string };

/** One row of the ranking behind an award; rank 1 is the award's winner. */
export type AwardRank = { rank: number; player: Player; team: Team; value: number; unit: string; appearances: number };
export type TeamAward = { label: string; team: Team; value: number; unit: string };

export type SeasonAwards = {
  competition: Competition;
  player_awards: PlayerAward[];
  team_awards: TeamAward[];
};

export type AuditEntry = {
  id: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  match_id: string | null;
  summary: string;
  created_at: string;
};

export type LeaderMetric = 'goals' | 'assists' | 'cards';

// Not in the generated schema yet; catches up on the next `npm run api:types`.
export type ExtraEventType = 'own_goal' | 'penalty_missed';
export type SubstitutionReason = 'tactical' | 'injury' | 'concussion' | 'disciplinary' | 'other';
export type PenaltyOutcome = 'saved' | 'off_target';

/** Why a player came off. Empty value means the admin did not say. */
export const SUBSTITUTION_REASONS: { label: string; value: SubstitutionReason }[] = [
  { label: 'Tactical', value: 'tactical' },
  { label: 'Injury', value: 'injury' },
  { label: 'Concussion', value: 'concussion' },
  { label: 'Disciplinary', value: 'disciplinary' },
  { label: 'Other', value: 'other' },
];

export const PENALTY_OUTCOMES: { label: string; value: PenaltyOutcome }[] = [
  { label: 'Saved', value: 'saved' },
  { label: 'Off target', value: 'off_target' },
];

export type TeamStaff = { coach: string | null; assistant_coach: string | null; competition_id: string | null; competition_group_id: string | null };

/**
 * Which badge a team wears, kept apart from `is_aimz` so a league of peer clubs
 * can each keep their own. Null leaves the choice to `is_aimz`, as it was
 * before the column existed.
 */
export type BadgeStyle = 'aimz' | 'generated';

// Not in the generated schema yet; catches up on the next `npm run api:types`.
export type Team = TeamStaff & Omit<Schema['TeamRead'], 'squad_code' | 'age_group' | 'season' | 'logo_key'> & {
  squad_code: string | null;
  age_group: string | null;
  season: string | null;
  logo_key: string | null;
  badge_style: BadgeStyle | null;
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

/**
 * Outfield shapes per format. Every entry sums to the format minus the keeper,
 * so a 7-a-side match is never offered an 11-a-side shape.
 */
export const FORMATIONS: Record<LineupFormat, string[]> = {
  5: ['2-2', '1-3', '3-1', '1-2-1'],
  6: ['2-3', '3-2', '2-1-2', '1-3-1'],
  7: ['3-2-1', '2-3-1', '3-1-2', '2-1-3', '1-3-2'],
  9: ['3-3-2', '3-2-3', '4-3-1', '2-4-2', '3-4-1'],
  11: ['4-4-2', '4-3-3', '3-4-3', '4-2-3-1', '3-5-2', '5-3-2'],
};

/** Digits of a formation, e.g. "4-4-2" -> [4, 4, 2]. */
export function formationRows(formation: string): number[] {
  return formation.split('-').map(Number).filter((value) => Number.isFinite(value) && value > 0);
}

export function outfieldCount(format: LineupFormat): number {
  return format - 1;
}

/** Extra time is always two periods, per football convention. */
export const EXTRA_TIME_PERIODS = 2;

export type Match = Omit<Schema['MatchRead'], 'home_team' | 'away_team' | 'competition'> & {
  home_team: Team | null;
  away_team: Team | null;
  competition: Competition | null;
  // Not in the generated schema yet; catches up on the next `npm run api:types`.
  lineup_format: LineupFormat | null;
  formation: string | null;
  man_of_the_match_player_id: string | null;
  man_of_the_match_is_opponent?: boolean;
};

/** (half × halves) + (break × (halves − 1)), plus two extra-time periods when enabled. */
export function totalMatchMinutes(structure: MatchTimeStructure): number {
  const { half_length_minutes, num_halves, half_time_break_minutes } = structure;
  const regulation = half_length_minutes * num_halves + half_time_break_minutes * Math.max(0, num_halves - 1);
  return regulation + (structure.has_extra_time ? EXTRA_TIME_PERIODS * structure.extra_time_half_length_minutes : 0);
}

export type MatchEventExtras = {
  is_penalty: boolean;
  // Not in the generated schema yet; catches up on the next `npm run api:types`.
  substitution_reason: SubstitutionReason | null;
  penalty_outcome: PenaltyOutcome | null;
};

export type MatchEvent = MatchEventExtras & Omit<
  Schema['MatchEventRead'],
  'type' | 'minute' | 'player_id' | 'secondary_player_id' | 'related_event_id' | 'notes'
> & {
  type: EventType;
  minute: number | null;
  player_id: string | null;
  secondary_player_id: string | null;
  related_event_id: string | null;
  notes: string | null;
};

// Not in the generated schema yet; catches up on the next `npm run api:types`.
export type LineupCaptain = { is_captain: boolean };

export type LineupEntry = LineupCaptain & Omit<
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
