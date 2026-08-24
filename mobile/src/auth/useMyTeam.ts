import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/src/auth/AuthProvider';
import { api } from '@/src/lib/api';

export function useMyTeam() {
  const { user } = useAuth();
  const players = useQuery({ queryKey: ['players'], queryFn: () => api.players('?limit=100'), enabled: Boolean(user?.player_id) });
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api.teams('?limit=100'), enabled: Boolean(user?.player_id) });
  const player = players.data?.items.find((item) => item.id === user?.player_id) ?? null;
  const team = teams.data?.items.find((item) => item.id === player?.team_id) ?? null;
  return { playerId: user?.player_id ?? null, teamId: player?.team_id ?? null, player, team, isLoading: players.isLoading || teams.isLoading, isError: players.isError || teams.isError, refetch: async () => { await Promise.all([players.refetch(), teams.refetch()]); } };
}
