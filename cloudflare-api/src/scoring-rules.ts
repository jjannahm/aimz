import type { AwardTotals, EventRow, StandingAccumulator } from "./types";

// Kept free of runtime imports so it can be unit tested the way match-clock is:
// Node's type stripping cannot resolve extensionless relative imports, and
// `import type` is erased before it tries.

// Assist is a column on the goal, never an event of its own, so it is absent here.
export const LOGGABLE_EVENTS = ["goal", "own_goal", "penalty_missed", "yellow_card", "red_card", "substitution"] as const;
export const SUBSTITUTION_REASONS = ["tactical", "injury", "concussion", "disciplinary", "other"] as const;
export const PENALTY_OUTCOMES = ["saved", "off_target"] as const;

// How many recent results the form guide shows.
export const FORM_LENGTH = 5;
// A one-match wonder should not win a discipline award.
export const MIN_AWARD_APPEARANCES = 3;

export type StatCounter = "goals" | "assists" | "own_goals" | "yellow_cards" | "red_cards";

export function eventCounter(type: EventRow["type"]): StatCounter | null {
  // Assists are credited from the goal they came from, never from the event type.
  // An own goal has its own counter so it never lands in goals; a missed penalty
  // has none at all.
  return ({
    goal: "goals", assist: null, own_goal: "own_goals", penalty_missed: null,
    yellow_card: "yellow_cards", red_card: "red_cards", substitution: null,
  } as const)[type];
}

export function describeEvent(event: Pick<EventRow, "type" | "minute">): string {
  const minute = event.minute === null ? "no minute" : `${event.minute}'`;
  return `${event.type.replace(/_/gu, " ")} at ${minute}`;
}

/**
 * Neither side is an AIMZ squad, so nobody from the academy is at the ground.
 *
 * A match like this is followed for the table it feeds, not scored from the
 * sideline: there is no one there to log a goal, a card or a substitution as it
 * happens. The admin enters the final score afterwards instead, and the whole
 * live scoring surface is refused for it.
 */
export function isOpponentOnly(homeIsAimz: number | boolean, awayIsAimz: number | boolean): boolean {
  return !homeIsAimz && !awayIsAimz;
}

export function outcome(scored: number, conceded: number): "W" | "D" | "L" {
  if (scored > conceded) return "W";
  return scored === conceded ? "D" : "L";
}

export function applyStanding(row: StandingAccumulator, scored: number, conceded: number): void {
  row.played += 1;
  row.goals_for += scored;
  row.goals_against += conceded;
  if (scored > conceded) {
    row.won += 1;
    row.points += 3;
  } else if (scored === conceded) {
    row.drawn += 1;
    row.points += 1;
  } else row.lost += 1;
}

export type AwardMetric = "motm" | "goals" | "assists" | "appearances" | "minutes" | "discipline";

/** One definition per award, feeding both its headline winner and its ranking. */
export interface AwardDefinition {
  metric: AwardMetric;
  label: string;
  unit: string;
  value: (row: AwardTotals) => number;
  /** Who is in the running at all. */
  eligible: (row: AwardTotals) => boolean;
  /** Best first. */
  compare: (a: AwardTotals, b: AwardTotals) => number;
}

// Most of anything: it takes one to count, and the fewer matches it took the
// better, so a player who did it in half a season outranks an ever-present.
function most(metric: AwardMetric, label: string, unit: string, value: (row: AwardTotals) => number): AwardDefinition {
  return { metric, label, unit, value, eligible: (row) => value(row) >= 1, compare: (a, b) => value(b) - value(a) || a.appearances - b.appearances };
}

export const AWARDS: AwardDefinition[] = [
  most("motm", "Most man of the match", "awards", (row) => row.motm),
  most("goals", "Top scorer", "goals", (row) => row.goals),
  most("assists", "Most assists", "assists", (row) => row.assists),
  most("appearances", "Most appearances", "appearances", (row) => row.appearances),
  most("minutes", "Most minutes", "minutes", (row) => row.minutes),
  // Fewest cards, not most, and only among regulars: an untested nil from a
  // player who barely featured is not a clean record.
  {
    metric: "discipline",
    label: "Best discipline",
    unit: "cards",
    value: (row) => row.cards,
    eligible: (row) => row.appearances >= MIN_AWARD_APPEARANCES,
    compare: (a, b) => a.cards - b.cards || b.appearances - a.appearances,
  },
];
