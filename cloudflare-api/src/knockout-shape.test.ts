import assert from "node:assert/strict";
import test from "node:test";

import { groupCountFor, resolveShape, roundLabel, roundsFor } from "./knockout-shape.ts";

const none = { team_count: null, group_size: null };

const shapeOf = (body: { team_count?: unknown; group_size?: unknown }) => {
  const result = resolveShape(body.team_count, body.group_size);
  assert.ok(result.ok, "expected the shape to hold");
  return result.shape;
};

const refusal = (body: { team_count?: unknown; group_size?: unknown }) => {
  const result = resolveShape(body.team_count, body.group_size);
  assert.ok(!result.ok, "expected the shape to be refused");
  return result;
};

test("a competition with no draw size is left alone", () => {
  assert.deepEqual(shapeOf({}), none);
  assert.deepEqual(shapeOf({ team_count: null }), none);
});

test("the presets keep their old shape", () => {
  assert.deepEqual(shapeOf({ team_count: 8 }), { team_count: 8, group_size: 4 });
  assert.deepEqual(shapeOf({ team_count: 16 }), { team_count: 16, group_size: 4 });
  assert.deepEqual(shapeOf({ team_count: 32 }), { team_count: 32, group_size: 4 });
});

test("a custom shape is taken at its word", () => {
  // Four groups of six: twenty-four teams, eight through, a quarter-final.
  assert.deepEqual(shapeOf({ team_count: 24, group_size: 6 }), { team_count: 24, group_size: 6 });
  assert.deepEqual(roundsFor(groupCountFor(24, 6)), [8, 4, 2]);
});

test("a group of one is not a group", () => {
  assert.equal(refusal({ team_count: 8, group_size: 1 }).field, "group_size");
});

test("a knockout needs more than one group", () => {
  assert.match(refusal({ team_count: 6, group_size: 6 }).message, /at least two groups/u);
});

test("teams that do not divide into the groups are refused", () => {
  assert.match(refusal({ team_count: 25, group_size: 6 }).message, /do not divide/u);
});

// Six groups send twelve teams through, and twelve is not a bracket. Refusing
// it at the door is what keeps the bracket free of byes.
test("a group count that will not halve is refused", () => {
  const problem = refusal({ team_count: 24, group_size: 4 });
  assert.equal(problem.field, "team_count");
  assert.match(problem.message, /12 teams through/u);
});

test("the rounds are named from what comes out of the groups", () => {
  assert.deepEqual(roundsFor(2).map(roundLabel), ["Semi Finals", "Final"]);
  assert.deepEqual(roundsFor(8).map(roundLabel), ["Round of 16", "Quarter Finals", "Semi Finals", "Final"]);
  // Groups of six or of four make the same bracket; only their number counts.
  assert.deepEqual(roundsFor(groupCountFor(24, 6)), roundsFor(groupCountFor(16, 4)));
});
