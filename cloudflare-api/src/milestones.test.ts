import assert from "node:assert/strict";
import test from "node:test";

import { summariseMilestones, type MilestoneMatch } from "./milestones.ts";

/** A run of ordinary matches, oldest first, which is the order the summary reads. */
function played(count: number, each: Partial<MilestoneMatch> = {}): MilestoneMatch[] {
  return Array.from({ length: count }, (_, index) => ({
    match_id: `m${index + 1}`,
    // One a week, so the order is unambiguous and the dates are real.
    kickoff_datetime: new Date(Date.UTC(2026, 0, 4 + index * 7)).toISOString(),
    appeared: true,
    goals: 0,
    assists: 0,
    motm: false,
    ...each,
  }));
}

const ids = (summary: ReturnType<typeof summariseMilestones>) => summary.reached.map((item) => item.id);

test("an empty record has nothing reached, nothing running and nothing to chase", () => {
  assert.deepEqual(summariseMilestones([]), { reached: [], streaks: [], next: [] });
});

test("a player who has only ever been an unused substitute has no first appearance", () => {
  const summary = summariseMilestones(played(4, { appeared: false }));
  assert.deepEqual(summary.reached, []);
  assert.deepEqual(summary.next, []);
});

test("firsts are recorded once, on the match they happened in", () => {
  const matches = played(3);
  matches[1]!.goals = 1;
  matches[1]!.assists = 1;
  matches[2]!.goals = 1;
  const summary = summariseMilestones(matches);
  assert.equal(ids(summary).filter((id) => id === "first-goal").length, 1);
  const first = summary.reached.find((item) => item.id === "first-goal");
  assert.equal(first?.match_id, "m2");
  assert.ok(ids(summary).includes("first-assist"));
  assert.ok(ids(summary).includes("first-appearance"));
});

test("crossing fifty appearances is reached on the fiftieth match", () => {
  const summary = summariseMilestones(played(50));
  const fifty = summary.reached.find((item) => item.id === "appearances-50");
  assert.equal(fifty?.match_id, "m50");
  assert.equal(fifty?.label, "50 appearances");
  // Every mark below it was passed on the way.
  for (const mark of [10, 25]) assert.ok(ids(summary).includes(`appearances-${mark}`));
  assert.equal(ids(summary).includes("appearances-100"), false);
});

test("appearances only count matches the player actually played", () => {
  const matches = [...played(9), ...played(3, { appeared: false }), ...played(1)];
  // Ten appearances across fourteen matches.
  const summary = summariseMilestones(matches.map((match, index) => ({ ...match, match_id: `m${index + 1}` })));
  assert.ok(ids(summary).includes("appearances-10"));
  assert.equal(summary.reached.find((item) => item.id === "appearances-10")?.match_id, "m13");
});

test("a hat-trick is recorded, and four goals is named for what it is", () => {
  const three = played(1);
  three[0]!.goals = 3;
  assert.ok(summariseMilestones(three).reached.some((item) => item.label === "Hat-trick"));

  const four = played(1);
  four[0]!.goals = 4;
  assert.ok(summariseMilestones(four).reached.some((item) => item.label === "4 goals in a match"));
});

test("a goal mark crossed mid-match still counts", () => {
  // Four singles then a brace: the fifth goal arrives without a match ending on
  // exactly five, so an equality test would miss it.
  const matches = played(5, { goals: 1 });
  matches[4]!.goals = 2;
  assert.ok(ids(summariseMilestones(matches)).includes("goals-5"));
});

test("a scoring streak runs back from the last match and a blank ends it", () => {
  const scoring = played(4, { goals: 1 });
  assert.deepEqual(summariseMilestones(scoring).streaks.find((item) => item.id === "scoring-streak"), {
    id: "scoring-streak",
    label: "Scored in 4 consecutive matches",
    count: 4,
  });

  const broken = played(4, { goals: 1 });
  broken[3]!.goals = 0;
  assert.equal(summariseMilestones(broken).streaks.some((item) => item.id === "scoring-streak"), false);
});

test("one scoring match is not a run", () => {
  const matches = played(3);
  matches[2]!.goals = 1;
  assert.equal(summariseMilestones(matches).streaks.some((item) => item.id === "scoring-streak"), false);
});

test("being left out ends an appearance run but not a scoring one", () => {
  const matches = played(4, { goals: 1 });
  matches[2]!.appeared = false;
  matches[2]!.goals = 0;
  const summary = summariseMilestones(matches);
  // Four matches, one missed, so the appearance run is only the last one.
  assert.equal(summary.streaks.some((item) => item.id === "appearance-streak"), false);
  // Three matches were played and she scored in all three: the run reads over
  // the match she missed rather than being ended by it.
  assert.equal(summary.streaks.find((item) => item.id === "scoring-streak")?.count, 3);
});

test("the next milestone counts down to the mark ahead", () => {
  const summary = summariseMilestones(played(48, { goals: 1 }));
  assert.deepEqual(summary.next.find((item) => item.id === "next-appearances"), {
    id: "next-appearances",
    label: "2 more appearances to 50",
    current: 48,
    target: 50,
    remaining: 2,
  });
});

test("one away from a mark reads in the singular", () => {
  const summary = summariseMilestones(played(9));
  assert.equal(summary.next.find((item) => item.id === "next-appearances")?.label, "1 more appearance to 10");
});

test("a track the player has not started is not offered", () => {
  const summary = summariseMilestones(played(3));
  assert.deepEqual(summary.next.map((item) => item.id), ["next-appearances"]);
});

test("past the last mark on a track, that track drops away", () => {
  const summary = summariseMilestones(played(100));
  assert.equal(summary.next.some((item) => item.id === "next-appearances"), false);
});

test("man of the match awards accumulate and are chased like the rest", () => {
  const summary = summariseMilestones(played(5, { motm: true }));
  assert.ok(ids(summary).includes("first-motm"));
  assert.ok(ids(summary).includes("motm-5"));
  assert.equal(summary.next.find((item) => item.id === "next-motm")?.label, "5 more awards to 10");
});

test("the most recent milestone is listed first", () => {
  const matches = played(12);
  matches[11]!.goals = 1;
  const summary = summariseMilestones(matches);
  assert.equal(summary.reached[0]?.id, "first-goal");
  assert.equal(summary.reached.at(-1)?.id, "first-appearance");
});
