import type { MatchPhase, MatchRow, MatchStatus } from "./types";

export type MatchPhaseAction = "start_match" | "halftime" | "start_second_half" | "start_extra_time" | "finish_match";

export type MatchClockTransition = Pick<MatchRow, "status" | "phase" | "phase_started_at">;
type MatchClockInput = Pick<MatchRow, "status" | "phase" | "phase_started_at"> & Partial<Pick<MatchRow, "has_extra_time">>;

export class MatchPhaseTransitionError extends Error {
  readonly code: "invalid_match_phase" | "invalid_match_status";

  constructor(code: "invalid_match_phase" | "invalid_match_status") {
    super(code === "invalid_match_phase"
      ? "That match phase change is not available from the current state."
      : "Use the live scoring controls to change the match status in order.");
    this.code = code;
    this.name = "MatchPhaseTransitionError";
  }
}

export function transitionMatchPhase(
  match: MatchClockInput,
  action: MatchPhaseAction,
  occurredAt: string,
): MatchClockTransition {
  const allowed: Record<MatchPhaseAction, { status: MatchStatus; phases: MatchPhase[] }> = {
    start_match: { status: "scheduled", phases: ["not_started"] },
    halftime: { status: "live", phases: ["first_half"] },
    start_second_half: { status: "live", phases: ["halftime"] },
    start_extra_time: { status: "live", phases: ["second_half"] },
    finish_match: { status: "live", phases: ["first_half", "halftime", "second_half", "extra_time"] },
  };
  const expected = allowed[action];
  if (match.status !== expected.status || !expected.phases.includes(match.phase) || (action === "start_extra_time" && match.has_extra_time === 0)) {
    throw new MatchPhaseTransitionError("invalid_match_phase");
  }

  if (action === "start_match") return { status: "live", phase: "first_half", phase_started_at: occurredAt };
  if (action === "halftime") return { status: "live", phase: "halftime", phase_started_at: null };
  if (action === "start_second_half") return { status: "live", phase: "second_half", phase_started_at: occurredAt };
  if (action === "start_extra_time") return { status: "live", phase: "extra_time", phase_started_at: occurredAt };
  return { status: "finished", phase: "finished", phase_started_at: null };
}

export function transitionLegacyStatus(
  match: MatchClockInput,
  nextStatus: MatchStatus,
  occurredAt: string,
): MatchClockTransition {
  if (nextStatus === match.status) return { status: match.status, phase: match.phase, phase_started_at: match.phase_started_at };
  if (match.status === "scheduled" && nextStatus === "live") return transitionMatchPhase(match, "start_match", occurredAt);
  if (match.status === "live" && nextStatus === "finished") return transitionMatchPhase(match, "finish_match", occurredAt);
  throw new MatchPhaseTransitionError("invalid_match_status");
}
