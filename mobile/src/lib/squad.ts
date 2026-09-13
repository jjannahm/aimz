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
  const teams = useQuery({ queryKey: cacheKeys.teams, queryFn: () => api.teams() });
  if (!teamId) return false;
  return Boolean(teams.data?.items.find((team) => team.id === teamId)?.competition_id);
}

/**
 * The squads this account is attached to, from the API rather than inferred.
 *
 * `null` means no restriction, which is an administrator. An empty list is an
 * account waiting to be linked to a player or assigned a squad. The same
 * answer the API scopes every request by, so the navigation the app draws and
 * the data it is allowed cannot disagree.
 */
export function useMyTeamIds(): { teamIds: string[] | null; isLoading: boolean } {
  const me = useQuery({ queryKey: cacheKeys.me, queryFn: () => api.me() });
  return { teamIds: me.data?.team_ids ?? null, isLoading: me.isLoading };
}

/**
 * Whether this account has a league or cup to look at.
 *
 * The competitions list is already scoped to the caller, so a squad entered in
 * nothing comes back with only the friendlies its own fixtures belong to — and
 * a standings tab drawn from that would be empty. This is what decides whether
 * the tab is drawn at all.
 */
export function useHasCompetition(): { hasCompetition: boolean; isLoading: boolean } {
  const competitions = useQuery({ queryKey: cacheKeys.competitions, queryFn: () => api.competitions() });
  return {
    hasCompetition: (competitions.data?.items ?? []).some((competition) => competition.type !== 'friendly'),
    isLoading: competitions.isLoading,
  };
}
