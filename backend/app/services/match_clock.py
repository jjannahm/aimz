from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from app.core.errors import api_error
from app.db.models import Match, MatchPhase, MatchStatus

MatchPhaseAction = Literal[
    "start_match",
    "halftime",
    "start_second_half",
    "start_extra_time",
    "finish_match",
]


def apply_phase_action(
    match: Match,
    action: MatchPhaseAction,
    *,
    occurred_at: datetime | None = None,
) -> None:
    now = occurred_at or datetime.now(UTC)
    expected: dict[MatchPhaseAction, tuple[MatchStatus, set[MatchPhase]]] = {
        "start_match": (MatchStatus.scheduled, {MatchPhase.not_started}),
        "halftime": (MatchStatus.live, {MatchPhase.first_half}),
        "start_second_half": (MatchStatus.live, {MatchPhase.halftime}),
        "start_extra_time": (MatchStatus.live, {MatchPhase.second_half}),
        "finish_match": (
            MatchStatus.live,
            {
                MatchPhase.first_half,
                MatchPhase.halftime,
                MatchPhase.second_half,
                MatchPhase.extra_time,
            },
        ),
    }
    expected_status, expected_phases = expected[action]
    if (
        match.status != expected_status
        or match.phase not in expected_phases
        or (action == "start_extra_time" and not match.has_extra_time)
    ):
        raise api_error(
            409,
            "invalid_match_phase",
            "That match phase change is not available from the current state.",
        )

    if action == "start_match":
        match.status = MatchStatus.live
        match.phase = MatchPhase.first_half
        match.phase_started_at = now
    elif action == "halftime":
        match.phase = MatchPhase.halftime
        match.phase_started_at = None
    elif action == "start_second_half":
        match.phase = MatchPhase.second_half
        match.phase_started_at = now
    elif action == "start_extra_time":
        match.phase = MatchPhase.extra_time
        match.phase_started_at = now
    else:
        match.status = MatchStatus.finished
        match.phase = MatchPhase.finished
        match.phase_started_at = None


def apply_legacy_status_change(match: Match, next_status: MatchStatus) -> None:
    if next_status == match.status:
        return
    if match.status == MatchStatus.scheduled and next_status == MatchStatus.live:
        apply_phase_action(match, "start_match")
        return
    if match.status == MatchStatus.live and next_status == MatchStatus.finished:
        apply_phase_action(match, "finish_match")
        return
    raise api_error(
        409,
        "invalid_match_status",
        "Use the live scoring controls to change the match status in order.",
    )
