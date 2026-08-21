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
    ManOfTheMatchInput,
    MatchEventInput,
    MatchEventRead,
    MatchEventUpdate,
    MatchPhaseUpdate,
    MatchRead,
    PlayerMatchStatRead,
    PlayerStatInput,
)
from app.services.audit import record_audit
from app.services.match_clock import apply_phase_action
from app.services.scoring import add_event, load_match_detail, remove_event, update_event

router = APIRouter()


def describe_event(event: MatchEvent) -> str:
    minute = "no minute" if event.minute is None else f"{event.minute}'"
    return f"{event.type.value.replace('_', ' ')} at {minute}"


async def require_match(session: SessionDep, match_id: str) -> Match:
    match = await session.get(Match, match_id)
    if match is None:
        raise api_error(404, "match_not_found", "Match not found.")
    return match


@router.post("/{match_id}/phase", response_model=MatchRead)
async def update_match_phase(
    match_id: str,
    payload: MatchPhaseUpdate,
    actor: AdminUser,
    session: SessionDep,
) -> Match:
    match = await require_match(session, match_id)
    apply_phase_action(match, payload.action)
    match.revision += 1
    record_audit(
        session,
        actor,
        action=payload.action,
        entity_type="match",
        entity_id=match_id,
        match_id=match_id,
        summary=f"Match clock moved to {match.phase.value.replace('_', ' ')}.",
    )
    await session.commit()
    refreshed = await load_match_detail(session, match_id)
    if refreshed is None:
        raise api_error(404, "match_not_found", "Match not found.")
    return refreshed


@router.post("/{match_id}/man-of-the-match", response_model=MatchRead)
async def set_man_of_the_match(
    match_id: str,
    payload: ManOfTheMatchInput,
    actor: AdminUser,
    session: SessionDep,
) -> Match:
    match = await require_match(session, match_id)
    if match.status != MatchStatus.finished:
        raise api_error(
            409, "match_not_finished", "Pick man of the match once the match has finished."
        )
    name = "No one"
    if payload.player_id is not None:
        player = await session.get(Player, payload.player_id)
        if player is None or player.team_id not in {match.home_team_id, match.away_team_id}:
            raise api_error(422, "invalid_award_player", "That player did not play in this match.")
        appeared = await session.scalar(
            select(PlayerMatchStat).where(
                PlayerMatchStat.match_id == match_id,
                PlayerMatchStat.player_id == payload.player_id,
                PlayerMatchStat.appeared.is_(True),
            )
        )
        if appeared is None:
            raise api_error(
                422, "player_did_not_appear", "Only a player who appeared can take the award."
            )
        name = player.name
    match.man_of_the_match_player_id = payload.player_id
    # The live snapshot is cached on this, so a stale ETag would hide the award.
    match.revision += 1
    record_audit(
        session,
        actor,
        action="man_of_the_match_set",
        entity_type="match",
        entity_id=match_id,
        match_id=match_id,
        summary=(
            "Cleared man of the match."
            if payload.player_id is None
            else f"Named {name} man of the match."
        ),
    )
    await session.commit()
    refreshed = await load_match_detail(session, match_id)
    if refreshed is None:
        raise api_error(404, "match_not_found", "Match not found.")
    return refreshed


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
    match_id: str, payload: MatchEventInput, actor: AdminUser, session: SessionDep
) -> MatchEvent:
    match = await require_match(session, match_id)
    if match.status == MatchStatus.scheduled:
        raise api_error(409, "match_not_started", "Start the match before adding events.")
    event = await add_event(session, match_id, payload)
    record_audit(
        session,
        actor,
        action="event_added",
        entity_type="match_event",
        entity_id=event.id,
        match_id=match_id,
        summary=f"Added {describe_event(event)}.",
    )
    await session.commit()
    await session.refresh(event)
    return event


@router.patch("/{match_id}/events/{event_id}", response_model=MatchEventRead)
async def edit_event(
    match_id: str,
    event_id: str,
    payload: MatchEventUpdate,
    actor: AdminUser,
    session: SessionDep,
) -> MatchEvent:
    event = await update_event(session, match_id, event_id, payload)
    record_audit(
        session,
        actor,
        action="event_corrected",
        entity_type="match_event",
        entity_id=event_id,
        match_id=match_id,
        summary=f"Corrected {describe_event(event)}.",
    )
    await session.commit()
    await session.refresh(event)
    return event


@router.delete("/{match_id}/events/{event_id}", status_code=204)
async def delete_event(
    match_id: str, event_id: str, actor: AdminUser, session: SessionDep
) -> Response:
    await remove_event(session, match_id, event_id)
    record_audit(
        session,
        actor,
        action="event_removed",
        entity_type="match_event",
        entity_id=event_id,
        match_id=match_id,
        summary="Removed an event from the timeline.",
    )
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
    actor: AdminUser,
    session: SessionDep,
) -> list[MatchLineupEntry]:
    match = await require_match(session, match_id)
    # Once the match is under way, who is on the pitch changes through
    # substitutions rather than by rewriting who started.
    if match.status != MatchStatus.scheduled:
        raise api_error(
            409,
            "lineup_locked",
            "The lineup is locked once the match starts. Log a substitution instead.",
        )
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
    starters = sum(row.is_starter for row in rows)
    record_audit(
        session,
        actor,
        action="lineup_saved",
        entity_type="lineup",
        entity_id=match_id,
        match_id=match_id,
        summary=f"Saved a lineup with {starters} starters.",
    )
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
    actor: AdminUser,
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
    record_audit(
        session,
        actor,
        action="minutes_saved",
        entity_type="player_stats",
        entity_id=match_id,
        match_id=match_id,
        summary=f"Saved minutes for {len(rows)} players.",
    )
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
