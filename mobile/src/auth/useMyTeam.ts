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
  const players = useQuery({ queryKey: ['players'], queryFn: () => api.players(), enabled: Boolean(user?.player_id) });
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api.teams(), enabled: Boolean(user?.player_id) });
  const player = players.data?.items.find((item) => item.id === user?.player_id) ?? null;
  const team = teams.data?.items.find((item) => item.id === player?.team_id) ?? null;
  return { playerId: user?.player_id ?? null, teamId: player?.team_id ?? null, player, team, isLoading: players.isLoading || teams.isLoading, isError: players.isError || teams.isError, refetch: async () => { await Promise.all([players.refetch(), teams.refetch()]); } };
}

/**
 * Whether this account may open a player's Information — who she is, and what
 * her family owes.
 *
 * An administrator may open anybody's; a player and a parent only the records
 * their own account speaks for; a coach nobody's, including on her own
 * squad. The API enforces exactly this, and refuses a coach both endpoints
 * outright — this only decides whether the tab is worth drawing.
 *
 * `undefined` while the answer is still coming, so a caller can hold the tab
 * back rather than flashing it away once the children arrive.
 */
export function useCanSeeInformation(playerId: string | null | undefined): boolean | undefined {
  const { user } = useAuth();
  const { children, isLoading } = useMyChildren();
  if (!playerId || !user) return false;
  if (user.role === 'admin') return true;
  // Squad management is football. A family's phone number and what they have
  // paid are not, and holding them is a liability rather than a convenience.
  if (user.role === 'coach') return false;
  if (user.player_id === playerId) return true;
  if (user.role !== 'parent') return false;
  return isLoading ? undefined : children.some((child) => child.id === playerId);
}
