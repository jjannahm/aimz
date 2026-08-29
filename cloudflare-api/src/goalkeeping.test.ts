import assert from "node:assert/strict";
import test from "node:test";

import { computeGoalkeeperStats, isGoalkeeper } from "./goalkeeping.ts";
import { GOALKEEPER, POSITIONS } from "./positions.ts";
import type { EventRow, LineupRow } from "./types.ts";

const named = (player_id: string, position: string | null, is_starter = 1): LineupRow =>
  ({ id: player_id, match_id: "m", player_id, team_id: "home", is_starter, is_captain: 0, position, jersey_number: null }) as LineupRow;

const happened = (over: Partial<EventRow>): EventRow =>
  ({ id: crypto.randomUUID(), match_id: "m", type: "goal", minute: 10, team_id: "away", player_id: null, secondary_player_id: null, related_event_id: null, notes: null, is_penalty: 0, substitution_reason: null, penalty_outcome: null, client_operation_id: null, created_at: "", updated_at: "", ...over }) as EventRow;

// goalkeeping.ts spells the keeper's code itself, because a unit-tested module
// cannot carry a runtime relative import. This is what stops the two drifting.
test("agrees with the vocabulary about which code the keeper wears", () => {
  assert.equal(isGoalkeeper(GOALKEEPER), true);
  assert.equal(POSITIONS.filter((position) => isGoalkeeper(position.code)).length, 1);
});

test("recognises the keeper by her position code", () => {
  assert.equal(isGoalkeeper("GK"), true);
  // Every other position in the vocabulary is an outfielder, as is no position
  // at all. Prose is no longer a position, so it is nobody.
  for (const value of ["CB", "LWB", "CM", "ST", null, "", "Goalkeeper", "gk"]) {
    assert.equal(isGoalkeeper(value), false, String(value));
  }
});

test("charges the keeper with what the other side scored", () => {
  const stats = computeGoalkeeperStats([named("gk", "GK"), named("d", "CB")], [happened({}), happened({ minute: 40 })], false);
  assert.equal(stats.get("gk")?.goals_conceded, 2);
  assert.equal(stats.has("d"), false, "an outfielder keeps no goalkeeping record");
});

// An own goal counts against the side that put it in, which is the rule the
// scoreline is built on, so it is their keeper who conceded.
test("counts an own goal against the keeper of the side that scored it", () => {
  const stats = computeGoalkeeperStats([named("gk", "GK")], [happened({ type: "own_goal", team_id: "home" })], false);
  assert.equal(stats.get("gk")?.goals_conceded, 1);
});

test("leaves a goal the keeper's own side scored off their record", () => {
  const stats = computeGoalkeeperStats([named("gk", "GK")], [happened({ team_id: "home" })], true);
  assert.equal(stats.get("gk")?.goals_conceded, 0);
  assert.equal(stats.get("gk")?.clean_sheet, 1);
});

test("credits a penalty only when the keeper actually saved it", () => {
  const saved = computeGoalkeeperStats([named("gk", "GK")], [happened({ type: "penalty_missed", penalty_outcome: "saved" })], false);
  assert.equal(saved.get("gk")?.penalties_saved, 1);
  const wide = computeGoalkeeperStats([named("gk", "GK")], [happened({ type: "penalty_missed", penalty_outcome: "off_target" })], false);
  assert.equal(wide.get("gk")?.penalties_saved, 0);
  // Our own miss is nobody's save at this end.
  const ours = computeGoalkeeperStats([named("gk", "GK")], [happened({ type: "penalty_missed", penalty_outcome: "saved", team_id: "home" })], false);
  assert.equal(ours.get("gk")?.penalties_saved, 0);
});

test("settles a clean sheet only once the match is over", () => {
  const running = computeGoalkeeperStats([named("gk", "GK")], [], false);
  assert.equal(running.get("gk")?.clean_sheet, 0);
  const done = computeGoalkeeperStats([named("gk", "GK")], [], true);
  assert.equal(done.get("gk")?.clean_sheet, 1);
});

// The half a keeper was not on the pitch for is not theirs to answer for.
test("splits a match between two keepers at the substitution", () => {
  const lineup = [named("first", "GK"), named("second", "GK", 0)];
  const events = [
    happened({ minute: 20 }),
    happened({ type: "substitution", minute: 45, player_id: "second", secondary_player_id: "first", team_id: "home" }),
    happened({ minute: 70 }),
  ];
  const stats = computeGoalkeeperStats(lineup, events, true);
  assert.equal(stats.get("first")?.goals_conceded, 1);
  assert.equal(stats.get("second")?.goals_conceded, 1);
  assert.equal(stats.get("first")?.clean_sheet, 0);
  assert.equal(stats.get("second")?.clean_sheet, 0);
});

test("keeps a named keeper who never came on off the record entirely", () => {
  const stats = computeGoalkeeperStats([named("gk", "GK"), named("bench", "GK", 0)], [happened({})], true);
  assert.equal(stats.get("gk")?.goals_conceded, 1);
  assert.equal(stats.has("bench"), false);
});
