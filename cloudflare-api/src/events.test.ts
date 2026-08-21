import assert from "node:assert/strict";
import test from "node:test";

import { describeEvent, eventCounter } from "./scoring-rules.ts";
import type { EventRow } from "./types.ts";

test("an own goal counts on its own column, never as a goal", () => {
  assert.equal(eventCounter("goal"), "goals");
  assert.equal(eventCounter("own_goal"), "own_goals");
});

test("assists, missed penalties and substitutions credit nothing to the scorer", () => {
  // An assist is a column on the goal it came from, not an event of its own.
  assert.equal(eventCounter("assist"), null);
  assert.equal(eventCounter("penalty_missed"), null);
  assert.equal(eventCounter("substitution"), null);
});

test("cards still count against the player who received them", () => {
  assert.equal(eventCounter("yellow_card"), "yellow_cards");
  assert.equal(eventCounter("red_card"), "red_cards");
});

test("an audit summary names the event and its minute", () => {
  const event = { type: "own_goal", minute: 22 } as EventRow;
  assert.equal(describeEvent(event), "own goal at 22'");
  assert.equal(describeEvent({ type: "goal", minute: null } as EventRow), "goal at no minute");
});
