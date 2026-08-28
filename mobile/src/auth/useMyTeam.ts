import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/src/auth/AuthProvider';
import { api } from '@/src/lib/api';

/**
 * The roster players the signed-in account speaks for: the one it is for a
 * player, and every child for a parent. The server decides, so a parent cannot
 * widen this by asking.
 */
export function useMyChildren() {
  const { user } = useAuth();
  const linked = user?.role === 'parent' || Boolean(user?.player_id);
  const query = useQuery({ queryKey: ['me', 'children'], queryFn: () => api.myChildren(), enabled: linked });
  return { children: query.data?.items ?? [], isLoading: query.isLoading, isError: query.isError, refetch: async () => { await query.refetch(); } };
}

export function useMyTeam() {
  const { user } = useAuth();
  const players = useQuery({ queryKey: ['players'], queryFn: () => api.players('?limit=100'), enabled: Boolean(user?.player_id) });
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api.teams('?limit=100'), enabled: Boolean(user?.player_id) });
  const player = players.data?.items.find((item) => item.id === user?.player_id) ?? null;
  const team = teams.data?.items.find((item) => item.id === player?.team_id) ?? null;
  return { playerId: user?.player_id ?? null, teamId: player?.team_id ?? null, player, team, isLoading: players.isLoading || teams.isLoading, isError: players.isError || teams.isError, refetch: async () => { await Promise.all([players.refetch(), teams.refetch()]); } };
}
