from fastapi import APIRouter, Header, Response, status
from sqlalchemy import delete, select

from app.api.deps import AdminUser, CurrentUser, SessionDep
from app.core.errors import api_error
from app.db.models import (
    Match,
    MatchEvent,
    MatchLineupEntry,
    MatchStatus,
    Player,
    PlayerMatchStat,
)
from app.schemas import (
    LineupEntryInput,
    LineupEntryRead,
    LiveMatchSnapshot,
    MatchEventInput,
    MatchEventRead,
    MatchEventUpdate,
    MatchRead,
    PlayerMatchStatRead,
    PlayerStatInput,
)
from app.services.scoring import add_event, load_match_detail, remove_event, update_event

router = APIRouter()


async def require_match(session: SessionDep, match_id: str) -> Match:
    match = await session.get(Match, match_id)
    if match is None:
        raise api_error(404, "match_not_found", "Match not found.")
    return match


@router.get("/{match_id}/events", response_model=list[MatchEventRead])
async def list_events(match_id: str, _: CurrentUser, session: SessionDep) -> list[MatchEvent]:
    await require_match(session, match_id)
    return list(
        (
            await session.scalars(
                select(MatchEvent)
                .where(MatchEvent.match_id == match_id)
                .order_by(MatchEvent.minute.asc().nullslast(), MatchEvent.created_at)
            )
        ).all()
    )


@router.post("/{match_id}/events", response_model=MatchEventRead, status_code=201)
async def create_event(
    match_id: str, payload: MatchEventInput, _: AdminUser, session: SessionDep
) -> MatchEvent:
    match = await require_match(session, match_id)
    if match.status == MatchStatus.scheduled:
        raise api_error(409, "match_not_started", "Start the match before adding events.")
    event = await add_event(session, match_id, payload)
    await session.commit()
    await session.refresh(event)
    return event


@router.patch("/{match_id}/events/{event_id}", response_model=MatchEventRead)
async def edit_event(
    match_id: str,
    event_id: str,
    payload: MatchEventUpdate,
    _: AdminUser,
    session: SessionDep,
) -> MatchEvent:
    event = await update_event(session, match_id, event_id, payload)
    await session.commit()
    await session.refresh(event)
    return event


@router.delete("/{match_id}/events/{event_id}", status_code=204)
async def delete_event(match_id: str, event_id: str, _: AdminUser, session: SessionDep) -> Response:
    await remove_event(session, match_id, event_id)
    await session.commit()
    return Response(status_code=204)


@router.get("/{match_id}/lineup", response_model=list[LineupEntryRead])
async def get_lineup(match_id: str, _: CurrentUser, session: SessionDep) -> list[MatchLineupEntry]:
    await require_match(session, match_id)
    return list(
        (
            await session.scalars(
                select(MatchLineupEntry)
                .where(MatchLineupEntry.match_id == match_id)
                .order_by(MatchLineupEntry.team_id, MatchLineupEntry.is_starter.desc())
            )
        ).all()
    )


@router.put("/{match_id}/lineup", response_model=list[LineupEntryRead])
async def replace_lineup(
    match_id: str,
    payload: list[LineupEntryInput],
    _: AdminUser,
    session: SessionDep,
) -> list[MatchLineupEntry]:
    match = await require_match(session, match_id)
    seen: set[str] = set()
    rows: list[MatchLineupEntry] = []
    for item in payload:
        if item.player_id in seen:
            raise api_error(422, "duplicate_player", "A player can appear once in a lineup.")
        if item.team_id not in {match.home_team_id, match.away_team_id}:
            raise api_error(422, "invalid_lineup_team", "Lineup team is not in this match.")
        player = await session.get(Player, item.player_id)
        if player is None or player.team_id != item.team_id:
            raise api_error(422, "invalid_lineup_player", "Player does not belong to that team.")
        seen.add(item.player_id)
        rows.append(MatchLineupEntry(match_id=match_id, **item.model_dump()))
    await session.execute(delete(MatchLineupEntry).where(MatchLineupEntry.match_id == match_id))
    session.add_all(rows)
    match.revision += 1
    await session.commit()
    for row in rows:
        await session.refresh(row)
    return rows


@router.get("/{match_id}/player-stats", response_model=list[PlayerMatchStatRead])
async def get_player_stats(
    match_id: str, _: CurrentUser, session: SessionDep
) -> list[PlayerMatchStat]:
    await require_match(session, match_id)
    return list(
        (
            await session.scalars(
                select(PlayerMatchStat)
                .where(PlayerMatchStat.match_id == match_id)
                .order_by(PlayerMatchStat.player_id)
            )
        ).all()
    )


@router.put("/{match_id}/player-stats", response_model=list[PlayerMatchStatRead])
async def update_player_stats(
    match_id: str,
    payload: list[PlayerStatInput],
    _: AdminUser,
    session: SessionDep,
) -> list[PlayerMatchStat]:
    match = await require_match(session, match_id)
    rows: list[PlayerMatchStat] = []
    for item in payload:
        player = await session.get(Player, item.player_id)
        if player is None or player.team_id not in {match.home_team_id, match.away_team_id}:
            raise api_error(422, "invalid_stat_player", "Player is not eligible for this match.")
        stat = await session.scalar(
            select(PlayerMatchStat).where(
                PlayerMatchStat.match_id == match_id,
                PlayerMatchStat.player_id == item.player_id,
            )
        )
        if stat is None:
            stat = PlayerMatchStat(match_id=match_id, player_id=item.player_id)
            session.add(stat)
        stat.appeared = item.appeared
        stat.minutes_played = item.minutes_played
        rows.append(stat)
    match.revision += 1
    await session.commit()
    for row in rows:
        await session.refresh(row)
    return rows


@router.get("/{match_id}/live", response_model=LiveMatchSnapshot)
async def live_snapshot(
    match_id: str,
    _: CurrentUser,
    session: SessionDep,
    response: Response,
    if_none_match: str | None = Header(default=None),
) -> LiveMatchSnapshot | Response:
    match = await load_match_detail(session, match_id)
    if match is None:
        raise api_error(404, "match_not_found", "Match not found.")
    etag = f'"match-{match.id}-{match.revision}"'
    if if_none_match == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})
    response.headers["ETag"] = etag
    events = sorted(
        match.events,
        key=lambda event: (event.minute is None, event.minute or 999, event.created_at),
    )
    return LiveMatchSnapshot(
        match=MatchRead.model_validate(match),
        events=[MatchEventRead.model_validate(event) for event in events],
        lineup=[LineupEntryRead.model_validate(item) for item in match.lineup],
        revision=match.revision,
    )
