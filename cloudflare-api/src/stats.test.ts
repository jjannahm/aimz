import assert from "node:assert/strict";
import test from "node:test";

import { applyStanding, outcome, type StandingAccumulator } from "./scoring-rules.ts";

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
