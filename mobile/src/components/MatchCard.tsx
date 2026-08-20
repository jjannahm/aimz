import { MatchRow } from '@/src/components/MatchRow';

import type { Match } from '@/src/types/api';

export type MatchCardData = Match;

type MatchCardProps = {
  match: MatchCardData;
};

export function MatchCard({ match }: MatchCardProps) {
  return <MatchRow match={match} />;
}
