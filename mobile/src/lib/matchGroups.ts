import type { Match, MatchStatus } from '@/src/types/api';

export type CompetitionMatchGroup = {
  competitionId: string;
  competitionName: string;
  matches: Match[];
};

export type DateMatchGroup = {
  dateKey: string;
  date: Date;
  isToday: boolean;
  matchesCount: number;
  competitions: CompetitionMatchGroup[];
};

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function groupMatches(matches: Match[], status: MatchStatus, now = new Date()): DateMatchGroup[] {
  const direction = status === 'finished' ? -1 : 1;
  const sorted = [...matches].sort((left, right) => direction * (Date.parse(left.kickoff_datetime) - Date.parse(right.kickoff_datetime)));
  const dates = new Map<string, Match[]>();
  for (const match of sorted) {
    const key = localDateKey(new Date(match.kickoff_datetime));
    const day = dates.get(key) ?? [];
    day.push(match);
    dates.set(key, day);
  }

  return [...dates.entries()].map(([dateKey, dayMatches]) => {
    const competitions = new Map<string, CompetitionMatchGroup>();
    for (const match of dayMatches) {
      const competitionId = match.competition?.id ?? match.competition_id;
      const existing = competitions.get(competitionId);
      if (existing) existing.matches.push(match);
      else competitions.set(competitionId, {
        competitionId,
        competitionName: match.competition?.name ?? 'AIMZ competition',
        matches: [match],
      });
    }
    const date = new Date(dayMatches[0]?.kickoff_datetime ?? now);
    return {
      dateKey,
      date,
      isToday: dateKey === localDateKey(now),
      matchesCount: dayMatches.length,
      competitions: [...competitions.values()],
    };
  });
}
