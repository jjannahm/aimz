"""The goalkeeping walk, ported from the Worker's goalkeeping.test.ts.

These exercise the pure walk over a team sheet and a timeline directly, on
transient ORM objects, the way the Worker unit-tests goalkeeping.ts. An
end-to-end pass through live scoring lives in test_goalkeeping_recording.py.
"""

import pytest

from app.db.models import EventType, MatchEvent, MatchLineupEntry, PenaltyOutcome
from app.services.goalkeeping import (
    compute_goalkeeper_stats,
    is_goalkeeper,
    players_who_took_the_field,
)
from app.services.positions import GOALKEEPER, POSITIONS


def named(player_id: str, position: str | None, is_starter: bool = True) -> MatchLineupEntry:
    return MatchLineupEntry(
        match_id="m",
        player_id=player_id,
        team_id="home",
        is_starter=is_starter,
        position=position,
    )


def happened(**over: object) -> MatchEvent:
    fields: dict[str, object] = {
        "match_id": "m",
        "type": EventType.goal,
        "minute": 10,
        "team_id": "away",
        "player_id": None,
        "secondary_player_id": None,
        "penalty_outcome": None,
    }
    fields.update(over)
    return MatchEvent(**fields)


def test_agrees_with_the_vocabulary_about_the_keeper_code() -> None:
    assert is_goalkeeper(GOALKEEPER) is True
    assert len([code for code, _name, _line in POSITIONS if is_goalkeeper(code)]) == 1


def test_recognises_the_keeper_by_position_code() -> None:
    assert is_goalkeeper("GK") is True
    # Every other code is an outfielder, as is no position; prose is nobody.
    for value in ("CB", "LWB", "CM", "ST", None, "", "Goalkeeper", "gk"):
        assert is_goalkeeper(value) is False, value


def test_charges_the_keeper_with_what_the_other_side_scored() -> None:
    stats = compute_goalkeeper_stats(
        [named("gk", "GK"), named("d", "CB")],
        [happened(), happened(minute=40)],
        False,
    )
    assert stats["gk"].goals_conceded == 2
    assert "d" not in stats


def test_counts_an_own_goal_against_the_side_that_scored_it() -> None:
    stats = compute_goalkeeper_stats(
        [named("gk", "GK")],
        [happened(type=EventType.own_goal, team_id="home")],
        False,
    )
    assert stats["gk"].goals_conceded == 1


def test_leaves_a_goal_the_keepers_own_side_scored_off_their_record() -> None:
    stats = compute_goalkeeper_stats([named("gk", "GK")], [happened(team_id="home")], True)
    assert stats["gk"].goals_conceded == 0
    assert stats["gk"].clean_sheet == 1


def test_credits_a_penalty_only_when_actually_saved() -> None:
    saved = compute_goalkeeper_stats(
        [named("gk", "GK")],
        [happened(type=EventType.penalty_missed, penalty_outcome=PenaltyOutcome.saved)],
        False,
    )
    assert saved["gk"].penalties_saved == 1
    wide = compute_goalkeeper_stats(
        [named("gk", "GK")],
        [happened(type=EventType.penalty_missed, penalty_outcome=PenaltyOutcome.off_target)],
        False,
    )
    assert wide["gk"].penalties_saved == 0
    ours = compute_goalkeeper_stats(
        [named("gk", "GK")],
        [
            happened(
                type=EventType.penalty_missed,
                penalty_outcome=PenaltyOutcome.saved,
                team_id="home",
            )
        ],
        False,
    )
    assert ours["gk"].penalties_saved == 0


def test_settles_a_clean_sheet_only_once_the_match_is_over() -> None:
    assert compute_goalkeeper_stats([named("gk", "GK")], [], False)["gk"].clean_sheet == 0
    assert compute_goalkeeper_stats([named("gk", "GK")], [], True)["gk"].clean_sheet == 1


def test_splits_a_match_between_two_keepers_at_the_substitution() -> None:
    lineup = [named("first", "GK"), named("second", "GK", is_starter=False)]
    events = [
        happened(minute=20),
        happened(
            type=EventType.substitution,
            minute=45,
            player_id="second",
            secondary_player_id="first",
            team_id="home",
        ),
        happened(minute=70),
    ]
    stats = compute_goalkeeper_stats(lineup, events, True)
    assert stats["first"].goals_conceded == 1
    assert stats["second"].goals_conceded == 1
    assert stats["first"].clean_sheet == 0
    assert stats["second"].clean_sheet == 0


def test_keeps_a_named_keeper_who_never_came_on_off_the_record() -> None:
    stats = compute_goalkeeper_stats(
        [named("gk", "GK"), named("bench", "GK", is_starter=False)],
        [happened()],
        True,
    )
    assert stats["gk"].goals_conceded == 1
    assert "bench" not in stats


def test_everyone_who_started_took_the_field() -> None:
    on_pitch = players_who_took_the_field([named("gk", "GK"), named("quiet", "CB")], [])
    assert "quiet" in on_pitch
    assert len(on_pitch) == 2


def test_a_substitute_counts_once_she_comes_on() -> None:
    lineup = [named("starter", "ST"), named("bench", "ST", is_starter=False)]
    assert "bench" not in players_who_took_the_field(lineup, [])
    brought_on = happened(
        type=EventType.substitution, minute=60, player_id="bench", secondary_player_id="starter"
    )
    on_pitch = players_who_took_the_field(lineup, [brought_on])
    assert "bench" in on_pitch
    # Being taken off does not undo having played.
    assert "starter" in on_pitch


def test_nobody_takes_the_field_without_a_team_sheet() -> None:
    assert len(players_who_took_the_field([], [])) == 0
