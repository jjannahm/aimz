import type { QueryClient } from '@tanstack/react-query';

/**
 * Every cache key the app reads, in one place.
 *
 * Keys are prefixes: `['players']` also clears `['players', 'roster']`, so
 * screens are free to scope their own variant without escaping invalidation.
 */
export const cacheKeys = {
  teams: ['teams'] as const,
  players: ['players'] as const,
  competitions: ['competitions'] as const,
  matches: ['matches'] as const,
  standings: ['standings'] as const,
  leaders: ['leaders'] as const,
  playerStats: ['player-stats'] as const,
  invites: ['invites'] as const,
  liveMatch: (id: string) => ['live-match', id] as const,
  allLiveMatches: ['live-match'] as const,
};

type Entity = 'team' | 'player' | 'competition' | 'match' | 'event' | 'lineup' | 'invite';

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
  team: [cacheKeys.teams, cacheKeys.players, cacheKeys.matches, cacheKeys.standings, cacheKeys.leaders, cacheKeys.allLiveMatches],
  player: [cacheKeys.players, cacheKeys.leaders, cacheKeys.playerStats, cacheKeys.allLiveMatches],
  competition: [cacheKeys.competitions, cacheKeys.matches, cacheKeys.standings],
  match: [cacheKeys.matches, cacheKeys.standings, cacheKeys.leaders, cacheKeys.playerStats, cacheKeys.allLiveMatches],
  event: [cacheKeys.matches, cacheKeys.standings, cacheKeys.leaders, cacheKeys.playerStats, cacheKeys.allLiveMatches],
  lineup: [cacheKeys.matches, cacheKeys.allLiveMatches],
  invite: [cacheKeys.invites],
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
