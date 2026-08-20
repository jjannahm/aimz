import assert from "node:assert/strict";
import test from "node:test";

import { MatchPhaseTransitionError, transitionLegacyStatus, transitionMatchPhase } from "./match-clock.ts";

const now = "2026-08-20T12:00:00.000Z";

test("moves through the operator-controlled football phases", () => {
  const firstHalf = transitionMatchPhase({ status: "scheduled", phase: "not_started", phase_started_at: null }, "start_match", now);
  assert.deepEqual(firstHalf, { status: "live", phase: "first_half", phase_started_at: now });
  const halftime = transitionMatchPhase(firstHalf, "halftime", now);
  assert.deepEqual(halftime, { status: "live", phase: "halftime", phase_started_at: null });
  const secondHalf = transitionMatchPhase(halftime, "start_second_half", now);
  assert.equal(secondHalf.phase, "second_half");
  const extraTime = transitionMatchPhase({ ...secondHalf, has_extra_time: 1 }, "start_extra_time", now);
  assert.equal(extraTime.phase, "extra_time");
  assert.deepEqual(transitionMatchPhase(extraTime, "finish_match", now), { status: "finished", phase: "finished", phase_started_at: null });
});

test("rejects phase skips", () => {
  assert.throws(
    () => transitionMatchPhase({ status: "scheduled", phase: "not_started", phase_started_at: null }, "start_second_half", now),
    MatchPhaseTransitionError,
  );
});

test("rejects extra time when the match configuration disables it", () => {
  assert.throws(
    () => transitionMatchPhase({ status: "live", phase: "second_half", phase_started_at: now, has_extra_time: 0 }, "start_extra_time", now),
    MatchPhaseTransitionError,
  );
});

test("keeps legacy start and finish status changes compatible", () => {
  const firstHalf = transitionLegacyStatus({ status: "scheduled", phase: "not_started", phase_started_at: null }, "live", now);
  assert.equal(firstHalf.phase, "first_half");
  assert.equal(transitionLegacyStatus(firstHalf, "finished", now).phase, "finished");
});
