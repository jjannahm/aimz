"""What a goalkeeper is answerable for in one match, ported from the Worker's
``goalkeeping.ts``.

These belong to the keeper who was on the pitch when it happened, which is not
always the keeper who started: a side that changes keeper at half time splits
the match between them, and the one who was not on cannot be charged with a goal
or credited with a clean sheet. Which keeper conceded a goal therefore depends
on who was on at the minute — a walk through the team sheet and the
substitutions, not something a single aggregate can count in place.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.db.models import EventType, MatchEvent, MatchLineupEntry, PenaltyOutcome
from app.services.positions import GOALKEEPER

# A minute past which "no minute recorded" events are taken to have happened —
# i.e. at the very end, where the last keeper of the match was standing.
_END_OF_MATCH = 10**9


def is_goalkeeper(position: str | None) -> bool:
    """Whether this is the goalkeeper's position. Positions are a fixed
    vocabulary, so it is simply the one code."""
    return position == GOALKEEPER


@dataclass
class GoalkeeperMatchStats:
    goals_conceded: int = 0
    penalties_saved: int = 0
    clean_sheet: int = 0


@dataclass
class _Spell:
    player_id: str
    frm: int
    to: int | None


def _spells_for(
    lineup: list[MatchLineupEntry], events: list[MatchEvent]
) -> list[_Spell]:
    """When each named player was on the pitch, in minutes.

    Starters are on from nought; a player brought on starts at the
    substitution's minute and one taken off stops there. ``to`` is None for
    anyone still on.
    """
    state: dict[str, list[int | None]] = {}
    for entry in lineup:
        state[entry.player_id] = [0 if entry.is_starter else None, None]

    subs = sorted(
        (event for event in events if event.type == EventType.substitution),
        key=lambda event: event.minute or 0,
    )
    for sub in subs:
        minute = max(0, sub.minute or 0)
        if sub.player_id:
            arriving = state.setdefault(sub.player_id, [None, None])
            if arriving[0] is None:
                arriving[0] = minute
        if sub.secondary_player_id:
            leaving = state.setdefault(sub.secondary_player_id, [0, None])
            if leaving[1] is None:
                leaving[1] = minute
    return [
        _Spell(player_id=player_id, frm=value[0] or 0, to=value[1])
        for player_id, value in state.items()
        if value[0] is not None
    ]


def players_who_took_the_field(
    lineup: list[MatchLineupEntry], events: list[MatchEvent]
) -> set[str]:
    """Everyone who took the field: the starters, plus anyone brought on. A named
    substitute who never came on is excluded — being on the team sheet is not the
    same as playing."""
    return {spell.player_id for spell in _spells_for(lineup, events)}


def _keeper_at(keeper_spells: list[_Spell], minute: int | None) -> str | None:
    """The keeper on the pitch at a given minute. An event with no minute is
    taken as having happened at the end, where the last keeper stood."""
    if len(keeper_spells) == 1:
        return keeper_spells[0].player_id
    at = minute if minute is not None else _END_OF_MATCH
    for spell in keeper_spells:
        if spell.frm <= at and (spell.to is None or at < spell.to):
            return spell.player_id
    # Falling back to whoever finished keeps a late goal off nobody's record.
    return keeper_spells[-1].player_id if keeper_spells else None


def compute_goalkeeper_stats(
    lineup: list[MatchLineupEntry], events: list[MatchEvent], finished: bool
) -> dict[str, GoalkeeperMatchStats]:
    """Goals conceded, penalties saved and clean sheets, by goalkeeper.

    A goal is conceded by the team it counts against, which for an own goal is
    the side that put it in — the same rule the scoreline is built on. A clean
    sheet is only settled once the match is over, and belongs to a keeper who
    conceded nothing while they were on.
    """
    spells = _spells_for(lineup, events)
    on_pitch = {spell.player_id for spell in spells}
    stats: dict[str, GoalkeeperMatchStats] = {}

    # Each side is handled on its own, so a match with two named teams charges
    # each keeper only with what went past them.
    for team_id in dict.fromkeys(entry.team_id for entry in lineup):
        keepers = [
            entry
            for entry in lineup
            if entry.team_id == team_id
            and is_goalkeeper(entry.position)
            and entry.player_id in on_pitch
        ]
        if not keepers:
            continue
        keeper_ids = {keeper.player_id for keeper in keepers}
        keeper_spells = [spell for spell in spells if spell.player_id in keeper_ids]
        for keeper in keepers:
            stats[keeper.player_id] = GoalkeeperMatchStats()

        for event in events:
            if event.type == EventType.goal:
                against = event.team_id != team_id
            elif event.type == EventType.own_goal:
                against = event.team_id == team_id
            else:
                against = False
            if against:
                keeper = _keeper_at(keeper_spells, event.minute)
                if keeper:
                    stats[keeper].goals_conceded += 1
                continue
            # A penalty the other side missed is the keeper's to claim only if
            # they saved it.
            if (
                event.type == EventType.penalty_missed
                and event.penalty_outcome == PenaltyOutcome.saved
                and event.team_id != team_id
            ):
                keeper = _keeper_at(keeper_spells, event.minute)
                if keeper:
                    stats[keeper].penalties_saved += 1

        if finished:
            for keeper in keepers:
                if stats[keeper.player_id].goals_conceded == 0:
                    stats[keeper.player_id].clean_sheet = 1
    return stats
