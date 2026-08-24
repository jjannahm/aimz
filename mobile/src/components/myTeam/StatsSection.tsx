import { useMyTeam } from '@/src/auth/useMyTeam';
import { PlayerStatsPanel } from '@/src/components/PlayerStatsPanel';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';

export function StatsSection() {
  const mine = useMyTeam();
  if (!mine.playerId) return <EmptyState body="Ask an AIMZ administrator to link your account to your squad player." title="Account not linked" />;
  if (mine.isLoading) return <LoadingState label="Loading your player profile" />;
  if (mine.isError) return <ErrorState message="Your player profile could not be loaded." onRetry={mine.refetch} />;
  return <PlayerStatsPanel playerId={mine.playerId} />;
}
