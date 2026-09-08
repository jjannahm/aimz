from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import api_error
from app.db.models import (
    EventType,
    Match,
    MatchEvent,
    MatchLineupEntry,
    MatchStatus,
    Player,
    PlayerMatchStat,
    Team,
)
from app.schemas import MatchEventInput, MatchEventUpdate
from app.services.competitions import require_open_season
from app.services.goalkeeping import compute_goalkeeper_stats, players_who_took_the_field


async def locked_match(session: AsyncSession, match_id: str) -> Match:
    match = await session.scalar(select(Match).where(Match.id == match_id).with_for_update())
    if match is None:
        raise api_error(404, "match_not_found", "Match not found.")
    return match


def is_opponent_only(home_is_aimz: bool, away_is_aimz: bool) -> bool:
    """Neither side is an AIMZ squad, so nobody from the academy is at the ground.

    A match like this is followed for the table it feeds, not scored from the
    sideline: there is no one there to log a goal, a card or a substitution as
    it happens. The admin enters the final score afterwards instead, and the
    whole live scoring surface is refused for it.
    """
    return not home_is_aimz and not away_is_aimz


async def opponent_only_match(session: AsyncSession, match: Match) -> bool:
    """Whether this match is between two opponent clubs.

    Reads the two flags with one query rather than through ``match.home_team``:
    the relationship is lazily loaded, and touching it here would raise
    ``MissingGreenlet`` under asyncio instead of answering the question.
    """
    flags = dict(
        (
            await session.execute(
                select(Team.id, Team.is_aimz).where(
                    Team.id.in_([match.home_team_id, match.away_team_id])
                )
            )
        ).all()
    )
    return is_opponent_only(
        bool(flags.get(match.home_team_id)), bool(flags.get(match.away_team_id))
    )


async def require_scorable(session: AsyncSession, match: Match) -> None:
    """Refuse the sideline surface on a match nobody from AIMZ attends.

    Hiding the buttons is not the boundary: a match between two opponent clubs
    has no timeline, no team sheet and no clock to run, so every write that
    assumes someone is watching is turned away here rather than left to write a
    half-recorded match. The final score goes in through /result instead.
    """
    if await opponent_only_match(session, match):
        raise api_error(
            409,
            "opponent_only_match",
            "This match is between two opponent teams. Enter the final score instead.",
        )


async def validate_event_people(
    session: AsyncSession,
    match: Match,
    team_id: str,
    player_ids: list[str | None],
) -> None:
    if team_id not in {match.home_team_id, match.away_team_id}:
        raise api_error(422, "invalid_event_team", "The event team is not in this match.")
    for player_id in filter(None, player_ids):
        player = await session.get(Player, player_id)
        if player is None or player.team_id != team_id:
            raise api_error(422, "invalid_event_player", "The selected player is not on that team.")


async def squads_for_match(session: AsyncSession, match: Match) -> dict[str, str]:
    """Which squad each player turned out for in this match.

    The lineup is the record of it and answers first. Anyone with a statistic
    but no lineup entry — minutes saved for a match nobody entered a sheet for —
    falls back to the squad they are on now, the best answer at the moment it is
    written, which is then fixed for good on the stat row.
    """
    squads: dict[str, str] = dict(
        (
            await session.execute(
                select(Player.id, Player.team_id).where(
                    Player.team_id.in_([match.home_team_id, match.away_team_id])
                )
            )
        ).all()
    )
    lineup = (
        await session.execute(
            select(MatchLineupEntry.player_id, MatchLineupEntry.team_id).where(
                MatchLineupEntry.match_id == match.id
            )
        )
    ).all()
    for player_id, team_id in lineup:
        squads[player_id] = team_id
    return squads


async def recompute_match(session: AsyncSession, match: Match) -> None:
    events = list(
        (
            await session.scalars(
                select(MatchEvent)
                .where(MatchEvent.match_id == match.id)
                .order_by(MatchEvent.created_at)
            )
        ).all()
    )

    def scored_for(team_id: str, opponent_id: str) -> int:
        # An own goal is filed against the team that conceded it, because that is
        # the team the scorer plays for. It counts on the opponent's scoreline.
        return sum(
            (event.type == EventType.goal and event.team_id == team_id)
            or (event.type == EventType.own_goal and event.team_id == opponent_id)
            for event in events
        )

    match.home_score = scored_for(match.home_team_id, match.away_team_id)
    match.away_score = scored_for(match.away_team_id, match.home_team_id)

    counters: dict[str, dict[EventType, int]] = {}
    for event in events:
        if event.player_id and event.type in {
            EventType.goal,
            EventType.own_goal,
            EventType.yellow_card,
            EventType.red_card,
        }:
            counters.setdefault(event.player_id, {}).setdefault(event.type, 0)
            counters[event.player_id][event.type] += 1
        # A goal carries its own assist, so the provider is credited from the
        # same row rather than from a separate event.
        if event.type == EventType.goal and event.secondary_player_id:
            counters.setdefault(event.secondary_player_id, {}).setdefault(EventType.assist, 0)
            counters[event.secondary_player_id][EventType.assist] += 1

    stats = list(
        (
            await session.scalars(
                select(PlayerMatchStat).where(PlayerMatchStat.match_id == match.id)
            )
        ).all()
    )
    squads = await squads_for_match(session, match)
    by_player = {stat.player_id: stat for stat in stats}
    for player_id in set(by_player) | set(counters):
        stat = by_player.get(player_id)
        if stat is None:
            stat = PlayerMatchStat(match_id=match.id, player_id=player_id, appeared=True)
            session.add(stat)
        # Stamp the squad she turned out for, so her record stays with it even if
        # she is later moved to another squad.
        stat.team_id = squads.get(player_id, stat.team_id)
        values = counters.get(player_id, {})
        stat.goals = values.get(EventType.goal, 0)
        stat.assists = values.get(EventType.assist, 0)
        stat.own_goals = values.get(EventType.own_goal, 0)
        stat.yellow_cards = values.get(EventType.yellow_card, 0)
        stat.red_cards = values.get(EventType.red_card, 0)
    match.revision += 1
    await session.flush()
    await recompute_pitch_stats(session, match)


async def recompute_pitch_stats(session: AsyncSession, match: Match) -> None:
    """Write what the team sheet and the timeline say about who was on the pitch.

    Two things fall out of the same walk, so they are worked out together rather
    than reading it twice.

    **Who appeared.** Taking the field is the appearance, and the team sheet is
    the record of it — not a side effect of scoring, so a player who turns out
    every week and never scores still counts. A named substitute who never comes
    on is not on the pitch, which is the point.

    **What the keeper is answerable for.** Who conceded a goal depends on which
    keeper was on at the minute, a walk rather than something an aggregate can
    count in place.

    Appearances are cleared first, but only for players the sheet governs — a
    substitution dropped in a correction takes its appearance with it, while a
    match scored without a sheet keeps the minutes saved by hand. The keeper
    columns are cleared for everyone, so a keeper moved out of goal keeps no tally
    they are no longer owed. Nothing is written before kickoff: a named XI for a
    match never played records nothing.

    Called wherever the lineup, the timeline, or the finished state changes.
    """
    if match.status == MatchStatus.scheduled:
        return
    lineup = list(
        (
            await session.scalars(
                select(MatchLineupEntry).where(MatchLineupEntry.match_id == match.id)
            )
        ).all()
    )
    events = list(
        (
            await session.scalars(
                select(MatchEvent).where(MatchEvent.match_id == match.id)
            )
        ).all()
    )
    on_pitch = players_who_took_the_field(lineup, events)
    keeper_stats = compute_goalkeeper_stats(
        lineup, events, match.status == MatchStatus.finished
    )
    squads = await squads_for_match(session, match)
    on_sheet = {entry.player_id for entry in lineup}

    stats = list(
        (
            await session.scalars(
                select(PlayerMatchStat).where(PlayerMatchStat.match_id == match.id)
            )
        ).all()
    )
    by_player = {stat.player_id: stat for stat in stats}
    for stat in stats:
        stat.goals_conceded = 0
        stat.penalties_saved = 0
        stat.clean_sheet = 0
        # Cleared only for players the sheet governs; a row scored without a sheet
        # keeps its hand-entered appearance.
        if stat.player_id in on_sheet:
            stat.appeared = False

    def _row_for(player_id: str) -> PlayerMatchStat:
        stat = by_player.get(player_id)
        if stat is None:
            stat = PlayerMatchStat(match_id=match.id, player_id=player_id, appeared=True)
            session.add(stat)
            by_player[player_id] = stat
        stat.appeared = True
        stat.team_id = squads.get(player_id, stat.team_id)
        return stat

    for player_id in on_pitch:
        _row_for(player_id)
    for player_id, row in keeper_stats.items():
        stat = _row_for(player_id)
        stat.goals_conceded = row.goals_conceded
        stat.penalties_saved = row.penalties_saved
        stat.clean_sheet = row.clean_sheet
    await session.flush()


async def add_event(session: AsyncSession, match_id: str, payload: MatchEventInput) -> MatchEvent:
    existing = await session.scalar(
        select(MatchEvent).where(MatchEvent.client_operation_id == payload.client_operation_id)
    )
    if existing:
        if existing.match_id != match_id:
            raise api_error(409, "operation_conflict", "That operation ID is already in use.")
        return existing
    match = await locked_match(session, match_id)
    await require_scorable(session, match)
    await require_open_season(session, match)
    await validate_event_people(
        session, match, payload.team_id, [payload.player_id, payload.secondary_player_id]
    )
    event = MatchEvent(match_id=match_id, **payload.model_dump())
    session.add(event)
    await session.flush()
    await recompute_match(session, match)
    return event


async def update_event(
    session: AsyncSession, match_id: str, event_id: str, payload: MatchEventUpdate
) -> MatchEvent:
    match = await locked_match(session, match_id)
    await require_scorable(session, match)
    await require_open_season(session, match)
    event = await session.scalar(
        select(MatchEvent).where(MatchEvent.id == event_id, MatchEvent.match_id == match_id)
    )
    if event is None:
        raise api_error(404, "event_not_found", "Match event not found.")
    changes = payload.model_dump(exclude_unset=True)
    team_id = changes.get("team_id", event.team_id)
    player_id = changes.get("player_id", event.player_id)
    secondary_id = changes.get("secondary_player_id", event.secondary_player_id)
    await validate_event_people(session, match, team_id, [player_id, secondary_id])
    for field, value in changes.items():
        setattr(event, field, value)
    await recompute_match(session, match)
    return event


async def remove_event(session: AsyncSession, match_id: str, event_id: str) -> None:
    match = await locked_match(session, match_id)
    await require_scorable(session, match)
    await require_open_season(session, match)
    event = await session.scalar(
        select(MatchEvent).where(MatchEvent.id == event_id, MatchEvent.match_id == match_id)
    )
    if event is None:
        raise api_error(404, "event_not_found", "Match event not found.")
    await session.execute(delete(MatchEvent).where(MatchEvent.id == event_id))
    await session.flush()
    await recompute_match(session, match)


async def load_match_detail(session: AsyncSession, match_id: str) -> Match | None:
    return await session.scalar(
        select(Match)
        .where(Match.id == match_id)
        .options(
            selectinload(Match.home_team),
            selectinload(Match.away_team),
            selectinload(Match.competition),
            selectinload(Match.events),
            selectinload(Match.lineup),
        )
    )
