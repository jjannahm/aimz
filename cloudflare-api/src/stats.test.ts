import assert from "node:assert/strict";
import test from "node:test";

import { applyStanding, AWARDS, isOpponentOnly, MIN_AWARD_APPEARANCES, outcome, type AwardDefinition } from "./scoring-rules.ts";
import type { AwardTotals, StandingAccumulator } from "./types.ts";

const totals = (player_id: string, fields: Partial<AwardTotals> = {}): AwardTotals =>
  ({ player_id, motm: 0, goals: 0, assists: 0, minutes: 0, cards: 0, appearances: 0, ...fields });

const award = (metric: string): AwardDefinition => {
  const found = AWARDS.find((item) => item.metric === metric);
  assert.ok(found, `no ${metric} award`);
  return found;
};

/** What the endpoint does: eligible only, best first. */
const rank = (metric: string, rows: AwardTotals[]) => {
  const definition = award(metric);
  return rows.filter(definition.eligible).sort(definition.compare).map((row) => row.player_id);
};

const blank = (): StandingAccumulator =>
  ({ played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points: 0 });

test("reads a result from the scoring team's side", () => {
  assert.equal(outcome(3, 0), "W");
  assert.equal(outcome(1, 1), "D");
  assert.equal(outcome(0, 2), "L");
});

test("accumulates a league table three points at a time", () => {
  const row = blank();
  applyStanding(row, 3, 0);
  applyStanding(row, 1, 1);
  applyStanding(row, 0, 2);
  assert.deepEqual(row, { played: 3, won: 1, drawn: 1, lost: 1, goals_for: 4, goals_against: 3, points: 4 });
});

test("a form strip reads newest first and stops at five", () => {
  // The endpoint accumulates oldest-first, then reverses and trims.
  const played: [number, number][] = [[1, 0], [0, 0], [0, 3], [2, 1], [1, 1], [4, 0]];
  const form = played.map(([scored, conceded]) => outcome(scored, conceded));
  assert.deepEqual([...form].reverse().slice(0, 5), ["W", "D", "W", "L", "D"]);
});

test("every award is keyed by a metric of its own", () => {
  const metrics = AWARDS.map((item) => item.metric);
  assert.equal(new Set(metrics).size, metrics.length);
});

test("most of anything needs one of it, and the fewer matches it took the better", () => {
  const rows = [
    totals("ever-present", { goals: 4, appearances: 20 }),
    totals("prolific", { goals: 4, appearances: 6 }),
    totals("benchwarmer", { goals: 0, appearances: 20 }),
  ];
  assert.deepEqual(rank("goals", rows), ["prolific", "ever-present"]);
});

test("the appearances award ranks on appearances rather than against them", () => {
  const rows = [totals("squad", { appearances: 2 }), totals("starter", { appearances: 9 })];
  assert.deepEqual(rank("appearances", rows), ["starter", "squad"]);
});

test("best discipline ranks the fewest cards first, not the most", () => {
  const rows = [
    totals("booked", { cards: 3, appearances: 8 }),
    totals("clean", { cards: 0, appearances: 8 }),
    totals("cautioned", { cards: 1, appearances: 8 }),
  ];
  assert.deepEqual(rank("discipline", rows), ["clean", "cautioned", "booked"]);
});

test("an untested nil does not win best discipline", () => {
  const rows = [
    totals("one-match wonder", { cards: 0, appearances: MIN_AWARD_APPEARANCES - 1 }),
    totals("regular", { cards: 2, appearances: MIN_AWARD_APPEARANCES }),
  ];
  assert.deepEqual(rank("discipline", rows), ["regular"]);
});

test("two equally clean records rank the busier season first", () => {
  const rows = [totals("squad", { cards: 0, appearances: 4 }), totals("starter", { cards: 0, appearances: 14 })];
  assert.deepEqual(rank("discipline", rows), ["starter", "squad"]);
});

test("a match between two opponent clubs has nobody there to score it", () => {
  assert.equal(isOpponentOnly(0, 0), true);
});

test("one AIMZ squad on either side is scored from the sideline as before", () => {
  assert.equal(isOpponentOnly(1, 0), false);
  assert.equal(isOpponentOnly(0, 1), false);
  assert.equal(isOpponentOnly(1, 1), false);
});

test("reads the flag whether D1 hands it back as an integer or a boolean", () => {
  assert.equal(isOpponentOnly(false, false), true);
  assert.equal(isOpponentOnly(true, false), false);
});
