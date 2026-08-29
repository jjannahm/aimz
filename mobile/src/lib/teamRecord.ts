import type { FormResult, Match, StandingRow } from '@/src/types/api';

/** A team's side of one match, once it has been played. */
export type PlayedMatch = {
  match: Match;
  opponent: Match['home_team'];
  scored: number;
  conceded: number;
  result: FormResult;
  home: boolean;
};

const resultOf = (scored: number, conceded: number): FormResult => scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';

/**
 * A team's finished matches, newest first, seen from that team's side.
 *
 * The API answers with matches as they were played — home and away — so the
 * side has to be worked out per match before anything can be counted.
 */
export function playedMatches(matches: Match[], teamId: string): PlayedMatch[] {
  return matches
    .filter((match) => match.status === 'finished')
    .sort((a, b) => Date.parse(b.kickoff_datetime) - Date.parse(a.kickoff_datetime))
    .map((match) => {
      const home = match.home_team_id === teamId;
      const scored = home ? match.home_score : match.away_score;
      const conceded = home ? match.away_score : match.home_score;
      return { match, home, scored, conceded, opponent: home ? match.away_team : match.home_team, result: resultOf(scored, conceded) };
    });
}

/** Matches still to come, soonest first. */
export function upcomingMatches(matches: Match[]): Match[] {
  return matches
    .filter((match) => match.status !== 'finished')
    .sort((a, b) => Date.parse(a.kickoff_datetime) - Date.parse(b.kickoff_datetime));
}

export type TeamSummary = {
  played: number; won: number; drawn: number; lost: number;
  goalsFor: number; goalsAgainst: number; goalDifference: number; points: number;
  winRate: number; pointsPerGame: number; cleanSheets: number;
  averageScored: number; averageConceded: number;
  form: FormResult[];
  streak: { result: FormResult; count: number } | null;
};

/**
 * What the table already knows, plus what only the matches can say.
 *
 * Position, points and the totals come from the standing row, which is the
 * record; clean sheets and the current streak are counted from the matches,
 * because the table does not carry them. Everything derived is rounded only
 * where it is shown, so nothing is stored half-rounded.
 */
export function summarise(row: StandingRow | undefined, played: PlayedMatch[]): TeamSummary | null {
  if (!row) return null;
  const cleanSheets = played.filter((entry) => entry.conceded === 0).length;
  const form = (row.form ?? []) as FormResult[];
  return {
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goals_for,
    goalsAgainst: row.goals_against,
    goalDifference: row.goal_difference,
    points: row.points,
    winRate: row.played ? row.won / row.played : 0,
    pointsPerGame: row.played ? row.points / row.played : 0,
    cleanSheets,
    averageScored: row.played ? row.goals_for / row.played : 0,
    averageConceded: row.played ? row.goals_against / row.played : 0,
    form,
    streak: currentStreak(played),
  };
}

/**
 * The run the team is on now, counted back from the most recent match.
 *
 * Null before a ball has been kicked, rather than a streak of nought, so the
 * screen can leave the line out instead of stating nothing.
 */
export function currentStreak(played: PlayedMatch[]): { result: FormResult; count: number } | null {
  const latest = played[0];
  if (!latest) return null;
  let count = 0;
  for (const entry of played) {
    if (entry.result !== latest.result) break;
    count += 1;
  }
  return { result: latest.result, count };
}

/** "1st", "2nd", "11th" — the suffix a league position is read with. */
export function ordinal(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return 'th';
  const last = rank % 10;
  return last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
}

export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const oneDecimal = (value: number) => value.toFixed(1);
