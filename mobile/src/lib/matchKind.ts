import type { Match } from '@/src/types/api';

export function isOpponentOnly(match: Pick<Match, 'home_team' | 'away_team'> | null | undefined): boolean {
  if (!match?.home_team || !match.away_team) return false;
  return !match.home_team.is_aimz && !match.away_team.is_aimz;
}
