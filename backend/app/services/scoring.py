from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import api_error
from app.db.models import EventType, Match, MatchEvent, Player, PlayerMatchStat
from app.schemas import MatchEventInput, MatchEventUpdate


async def locked_match(session: AsyncSession, match_id: str) -> Match:
    match = await session.scalar(select(Match).where(Match.id == match_id).with_for_update())
    if match is None:
        raise api_error(404, "match_not_found", "Match not found.")
    return match


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
    match.home_score = sum(
        event.type == EventType.goal and event.team_id == match.home_team_id for event in events
    )
    match.away_score = sum(
        event.type == EventType.goal and event.team_id == match.away_team_id for event in events
    )

    counters: dict[str, dict[EventType, int]] = {}
    for event in events:
        if event.player_id and event.type in {
            EventType.goal,
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
    by_player = {stat.player_id: stat for stat in stats}
    for player_id in set(by_player) | set(counters):
        stat = by_player.get(player_id)
        if stat is None:
            stat = PlayerMatchStat(match_id=match.id, player_id=player_id, appeared=True)
            session.add(stat)
        values = counters.get(player_id, {})
        stat.goals = values.get(EventType.goal, 0)
        stat.assists = values.get(EventType.assist, 0)
        stat.yellow_cards = values.get(EventType.yellow_card, 0)
        stat.red_cards = values.get(EventType.red_card, 0)
    match.revision += 1
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
