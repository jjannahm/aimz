import assert from "node:assert/strict";
import test from "node:test";

import { applyStanding, outcome, playerStatsQuery, type StandingAccumulator } from "./scoring-rules.ts";

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

test("a season summary counts finished matches only", () => {
  // Standings, leaders and awards all exclude a match still being played, and
  // a player's season totals have to agree with them, so a goal scored live
  // must not land on the record until the match is finished.
  assert.match(playerStatsQuery(null), /m\.status='finished'/u);
  assert.match(playerStatsQuery("2026/27"), /m\.status='finished'/u);
});

test("the season filter is bound, and only added when a season is asked for", () => {
  assert.match(playerStatsQuery("2026/27"), /AND cp\.season=\?/u);
  assert.doesNotMatch(playerStatsQuery(null), /cp\.season/u);
});
