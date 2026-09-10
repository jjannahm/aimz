import type { QueryClient } from '@tanstack/react-query';

/**
 * Every cache key the app reads, in one place.
 *
 * Keys are prefixes: `['players']` also clears `['players', 'roster']`, so
 * screens are free to scope their own variant without escaping invalidation.
 */
export const cacheKeys = {
  /** The signed-in account itself, including the squads it is attached to. */
  me: ['me'] as const,
  teams: ['teams'] as const,
  players: ['players'] as const,
  competitions: ['competitions'] as const,
  matches: ['matches'] as const,
  standings: ['standings'] as const,
  groups: ['competition-groups'] as const,
  bracket: ['bracket'] as const,
  leaders: ['leaders'] as const,
  playerStats: ['player-stats'] as const,
  invites: ['invites'] as const,
  accounts: ['accounts'] as const,
  training: ['training'] as const,
  announcements: ['announcements'] as const,
  availability: ['training-availability'] as const,
  attendance: ['training-attendance'] as const,
  /** Requests to correct a register, which a decision writes through to it. */
  attendanceRequests: ['attendance-requests'] as const,
  fees: ['fees'] as const,
  reports: ['player-reports'] as const,
  matchReport: (id: string) => ['match-report', id] as const,
  allMatchReports: ['match-report'] as const,
  trainingStats: ['training-stats'] as const,
  rosterDetails: ['roster-details'] as const,
  /** A player's own details, and her family's money. */
  personalDetails: ['personal-details'] as const,
  financials: ['financials'] as const,
  awards: ['awards'] as const,
  auditLog: ['audit-log'] as const,
  liveMatch: (id: string) => ['live-match', id] as const,
  allLiveMatches: ['live-match'] as const,
};

type Entity = 'team' | 'player' | 'competition' | 'match' | 'event' | 'lineup' | 'invite' | 'award' | 'bracket' | 'account' | 'training' | 'announcement' | 'availability' | 'attendance' | 'attendance-request' | 'match-report' | 'roster' | 'fee' | 'report' | 'training-stat';

/**
 * What a write touches, including everything derived from it.
 *
 * Standings, leaderboards, squad counts and season totals are all recomputed
 * from match and roster rows rather than stored, so a write to a source must
 * clear the views built on it or they keep serving a stale answer. Teams and
 * players reach further than they look because their names are rendered inside
 * matches, timelines and leaderboards.
 */
const affects: Record<Entity, (readonly string[])[]> = {
  team: [cacheKeys.teams, cacheKeys.players, cacheKeys.matches, cacheKeys.standings, cacheKeys.leaders, cacheKeys.allLiveMatches, cacheKeys.groups, cacheKeys.bracket, cacheKeys.training, cacheKeys.announcements],
  player: [cacheKeys.players, cacheKeys.leaders, cacheKeys.playerStats, cacheKeys.allLiveMatches, cacheKeys.accounts, cacheKeys.availability],
  competition: [cacheKeys.competitions, cacheKeys.matches, cacheKeys.standings, cacheKeys.awards, cacheKeys.groups, cacheKeys.bracket],
  match: [cacheKeys.matches, cacheKeys.standings, cacheKeys.leaders, cacheKeys.playerStats, cacheKeys.awards, cacheKeys.allLiveMatches, cacheKeys.bracket, cacheKeys.allMatchReports],
  event: [cacheKeys.matches, cacheKeys.standings, cacheKeys.leaders, cacheKeys.playerStats, cacheKeys.awards, cacheKeys.auditLog, cacheKeys.allLiveMatches, cacheKeys.bracket, cacheKeys.allMatchReports],
  bracket: [cacheKeys.bracket, cacheKeys.groups, cacheKeys.standings, cacheKeys.teams],
  lineup: [cacheKeys.matches, cacheKeys.auditLog, cacheKeys.allLiveMatches],
  invite: [cacheKeys.invites],
  account: [cacheKeys.accounts],
  training: [cacheKeys.training, cacheKeys.availability, cacheKeys.attendance],
  announcement: [cacheKeys.announcements],
  availability: [cacheKeys.availability],
  // A player's training attendance percentage is worked out from the register,
  // so marking somebody has to clear the stats built on it or a profile keeps
  // answering with the figure from before the mark.
  attendance: [cacheKeys.attendance, cacheKeys.playerStats, cacheKeys.trainingStats, cacheKeys.attendanceRequests],
  // Approving a correction writes the register, so it clears everything a mark
  // clears — and the requests themselves, one of which has just been answered.
  'attendance-request': [cacheKeys.attendanceRequests, cacheKeys.attendance, cacheKeys.playerStats, cacheKeys.trainingStats],
  // Plans, charges, payments and the squad ledger are all read back from the
  // same rows, so any one of them changing clears the lot.
  fee: [cacheKeys.fees, cacheKeys.financials],
  report: [cacheKeys.reports],
  'match-report': [cacheKeys.allMatchReports],
  // A reading changes the session's sheet and every total built on it.
  'training-stat': [cacheKeys.trainingStats, cacheKeys.playerStats],
  roster: [cacheKeys.rosterDetails, cacheKeys.players, cacheKeys.personalDetails],
  // Naming a man of the match changes the match, not the table or the scorers.
  award: [cacheKeys.matches, cacheKeys.auditLog, cacheKeys.allLiveMatches, cacheKeys.allMatchReports],
};

/**
 * Clear every view affected by a write, so admin actions land everywhere at
 * once rather than waiting for a poll or a restart.
 */
export async function invalidateAfterWrite(client: QueryClient, ...entities: Entity[]): Promise<void> {
  const keys = new Map<string, readonly string[]>();
  for (const entity of entities) {
    for (const key of affects[entity]) keys.set(key.join('/'), key);
  }
  await Promise.all([...keys.values()].map((queryKey) => client.invalidateQueries({ queryKey })));
}
