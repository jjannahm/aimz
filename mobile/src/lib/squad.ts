import { useQuery } from '@tanstack/react-query';

import { api } from '@/src/lib/api';
import { cacheKeys } from '@/src/lib/cache';

/**
 * Whether a squad plays matches at all.
 *
 * A squad entered in no competition has no fixtures to have played, so match
 * statistics are a question the app cannot answer rather than an answer of
 * nought. Read from the teams list every screen already warms on sign-in, so
 * asking costs nothing.
 */
export function useSquadPlaysMatches(teamId: string | null | undefined): boolean {
  const teams = useQuery({ queryKey: cacheKeys.teams, queryFn: () => api.teams('?limit=100') });
  if (!teamId) return false;
  return Boolean(teams.data?.items.find((team) => team.id === teamId)?.competition_id);
}
