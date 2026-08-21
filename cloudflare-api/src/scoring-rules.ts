import type { EventRow, StandingAccumulator } from "./types";

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
