from datetime import datetime
from typing import Any, TypeVar

from fastapi import APIRouter, Response
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import AdminUser, CurrentUser, SessionDep
from app.core.errors import api_error
from app.db.models import Competition, Match, MatchPhase, MatchStatus, Player, Team
from app.schemas import (
    CompetitionInput,
    CompetitionRead,
    MatchInput,
    MatchRead,
    Page,
    PlayerInput,
    PlayerRead,
    TeamInput,
    TeamRead,
)
from app.services.match_clock import apply_legacy_status_change, apply_phase_action

router = APIRouter()
ModelT = TypeVar("ModelT")


def page_args(limit: int, offset: int) -> tuple[int, int]:
    return min(max(limit, 1), 100), max(offset, 0)


async def commit_or_conflict(session: SessionDep, message: str) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise api_error(409, "data_conflict", message) from exc


@router.get("/teams", response_model=Page[TeamRead])
async def list_teams(
    _: CurrentUser,
    session: SessionDep,
    limit: int = 50,
    offset: int = 0,
    is_aimz: bool | None = None,
    season: str | None = None,
    active: bool | None = True,
) -> Page[TeamRead]:
    limit, offset = page_args(limit, offset)
    query = select(Team)
    count_query = select(func.count()).select_from(Team)
    for condition in [
        Team.is_aimz == is_aimz if is_aimz is not None else None,
        Team.season == season if season else None,
        Team.is_active == active if active is not None else None,
    ]:
        if condition is not None:
            query = query.where(condition)
            count_query = count_query.where(condition)
    total = await session.scalar(count_query) or 0
    teams = list(
        (await session.scalars(query.order_by(Team.name).limit(limit).offset(offset))).all()
    )
    return Page(items=teams, total=total, limit=limit, offset=offset)


@router.post("/teams", response_model=TeamRead, status_code=201)
async def create_team(payload: TeamInput, _: AdminUser, session: SessionDep) -> Team:
    team = Team(**payload.model_dump())
    session.add(team)
    await commit_or_conflict(session, "That squad conflicts with existing data.")
    await session.refresh(team)
    return team


@router.patch("/teams/{team_id}", response_model=TeamRead)
async def update_team(team_id: str, payload: TeamInput, _: AdminUser, session: SessionDep) -> Team:
    team = await session.get(Team, team_id)
    if not team:
        raise api_error(404, "team_not_found", "Team not found.")
    for field, value in payload.model_dump().items():
        setattr(team, field, value)
    await commit_or_conflict(session, "That squad conflicts with existing data.")
    await session.refresh(team)
    return team


@router.delete("/teams/{team_id}", status_code=204)
async def delete_team(team_id: str, _: AdminUser, session: SessionDep) -> Response:
    team = await session.get(Team, team_id)
    if not team:
        raise api_error(404, "team_not_found", "Team not found.")
    await session.delete(team)
    await commit_or_conflict(session, "Archive teams that are referenced by matches or players.")
    return Response(status_code=204)


@router.get("/competitions", response_model=Page[CompetitionRead])
async def list_competitions(
    _: CurrentUser, session: SessionDep, limit: int = 50, offset: int = 0, season: str | None = None
) -> Page[CompetitionRead]:
    limit, offset = page_args(limit, offset)
    query = select(Competition)
    count_query = select(func.count()).select_from(Competition)
    if season:
        query, count_query = (
            query.where(Competition.season == season),
            count_query.where(Competition.season == season),
        )
    total = await session.scalar(count_query) or 0
    rows = list(
        (
            await session.scalars(
                query.order_by(Competition.season.desc(), Competition.name)
                .limit(limit)
                .offset(offset)
            )
        ).all()
    )
    return Page(items=rows, total=total, limit=limit, offset=offset)


@router.post("/competitions", response_model=CompetitionRead, status_code=201)
async def create_competition(
    payload: CompetitionInput, _: AdminUser, session: SessionDep
) -> Competition:
    row = Competition(**payload.model_dump())
    session.add(row)
    await commit_or_conflict(session, "A competition with that name and season already exists.")
    await session.refresh(row)
    return row


@router.patch("/competitions/{competition_id}", response_model=CompetitionRead)
async def update_competition(
    competition_id: str, payload: CompetitionInput, _: AdminUser, session: SessionDep
) -> Competition:
    row = await session.get(Competition, competition_id)
    if not row:
        raise api_error(404, "competition_not_found", "Competition not found.")
    for field, value in payload.model_dump().items():
        setattr(row, field, value)
    await commit_or_conflict(session, "A competition with that name and season already exists.")
    await session.refresh(row)
    return row


@router.delete("/competitions/{competition_id}", status_code=204)
async def delete_competition(competition_id: str, _: AdminUser, session: SessionDep) -> Response:
    row = await session.get(Competition, competition_id)
    if not row:
        raise api_error(404, "competition_not_found", "Competition not found.")
    await session.delete(row)
    await commit_or_conflict(session, "Competitions used by matches cannot be deleted.")
    return Response(status_code=204)


@router.get("/players", response_model=Page[PlayerRead])
async def list_players(
    _: CurrentUser,
    session: SessionDep,
    limit: int = 50,
    offset: int = 0,
    team_id: str | None = None,
    season: str | None = None,
    active: bool | None = True,
) -> Page[PlayerRead]:
    limit, offset = page_args(limit, offset)
    query = select(Player)
    count_query = select(func.count()).select_from(Player)
    if team_id:
        query, count_query = (
            query.where(Player.team_id == team_id),
            count_query.where(Player.team_id == team_id),
        )
    if active is not None:
        query, count_query = (
            query.where(Player.is_active == active),
            count_query.where(Player.is_active == active),
        )
    if season:
        query = query.join(Team).where(Team.season == season)
        count_query = count_query.join(Team).where(Team.season == season)
    total = await session.scalar(count_query) or 0
    rows = list(
        (await session.scalars(query.order_by(Player.name).limit(limit).offset(offset))).all()
    )
    return Page(items=rows, total=total, limit=limit, offset=offset)


@router.post("/players", response_model=PlayerRead, status_code=201)
async def create_player(payload: PlayerInput, _: AdminUser, session: SessionDep) -> Player:
    if await session.get(Team, payload.team_id) is None:
        raise api_error(422, "team_not_found", "Selected team does not exist.")
    row = Player(**payload.model_dump())
    session.add(row)
    await commit_or_conflict(session, "That jersey number is already used by this team.")
    await session.refresh(row)
    return row


@router.patch("/players/{player_id}", response_model=PlayerRead)
async def update_player(
    player_id: str, payload: PlayerInput, _: AdminUser, session: SessionDep
) -> Player:
    row = await session.get(Player, player_id)
    if not row:
        raise api_error(404, "player_not_found", "Player not found.")
    for field, value in payload.model_dump().items():
        setattr(row, field, value)
    await commit_or_conflict(session, "That jersey number is already used by this team.")
    await session.refresh(row)
    return row


@router.delete("/players/{player_id}", status_code=204)
async def delete_player(player_id: str, _: AdminUser, session: SessionDep) -> Response:
    row = await session.get(Player, player_id)
    if not row:
        raise api_error(404, "player_not_found", "Player not found.")
    await session.delete(row)
    await commit_or_conflict(session, "Archive players referenced by historical match data.")
    return Response(status_code=204)


def match_options() -> tuple[Any, ...]:
    return (
        selectinload(Match.home_team),
        selectinload(Match.away_team),
        selectinload(Match.competition),
    )


@router.get("/matches", response_model=Page[MatchRead])
async def list_matches(
    _: CurrentUser,
    session: SessionDep,
    limit: int = 30,
    offset: int = 0,
    match_status: MatchStatus | None = None,
    team_id: str | None = None,
    competition_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> Page[MatchRead]:
    limit, offset = page_args(limit, offset)
    query = select(Match).options(*match_options())
    count_query = select(func.count()).select_from(Match)
    conditions = [
        Match.status == match_status if match_status else None,
        or_(Match.home_team_id == team_id, Match.away_team_id == team_id) if team_id else None,
        Match.competition_id == competition_id if competition_id else None,
        Match.kickoff_datetime >= date_from if date_from else None,
        Match.kickoff_datetime <= date_to if date_to else None,
    ]
    for condition in conditions:
        if condition is not None:
            query, count_query = query.where(condition), count_query.where(condition)
    total = await session.scalar(count_query) or 0
    rows = list(
        (
            await session.scalars(
                query.order_by(Match.kickoff_datetime.desc()).limit(limit).offset(offset)
            )
        ).all()
    )
    return Page(items=rows, total=total, limit=limit, offset=offset)


@router.get("/matches/{match_id}", response_model=MatchRead)
async def get_match(match_id: str, _: CurrentUser, session: SessionDep) -> Match:
    row = await session.scalar(select(Match).where(Match.id == match_id).options(*match_options()))
    if not row:
        raise api_error(404, "match_not_found", "Match not found.")
    return row


async def validate_match_refs(session: SessionDep, payload: MatchInput) -> None:
    if await session.get(Competition, payload.competition_id) is None:
        raise api_error(422, "competition_not_found", "Selected competition does not exist.")
    teams = list(
        (
            await session.scalars(
                select(Team).where(Team.id.in_([payload.home_team_id, payload.away_team_id]))
            )
        ).all()
    )
    if len(teams) != 2:
        raise api_error(422, "team_not_found", "One or more selected teams do not exist.")


@router.post("/matches", response_model=MatchRead, status_code=201)
async def create_match(payload: MatchInput, _: AdminUser, session: SessionDep) -> Match:
    await validate_match_refs(session, payload)
    requested_status = payload.status
    row = Match(
        **payload.model_dump(exclude={"status"}),
        status=MatchStatus.scheduled,
        phase=MatchPhase.not_started,
    )
    if requested_status == MatchStatus.live:
        apply_phase_action(row, "start_match")
    elif requested_status == MatchStatus.finished:
        row.status = MatchStatus.finished
        row.phase = MatchPhase.finished
    session.add(row)
    await session.commit()
    return await get_match(row.id, _, session)


@router.patch("/matches/{match_id}", response_model=MatchRead)
async def update_match(
    match_id: str, payload: MatchInput, _: AdminUser, session: SessionDep
) -> Match:
    row = await session.get(Match, match_id)
    if not row:
        raise api_error(404, "match_not_found", "Match not found.")
    await validate_match_refs(session, payload)
    next_status = payload.status
    for field, value in payload.model_dump(exclude={"status"}).items():
        setattr(row, field, value)
    apply_legacy_status_change(row, next_status)
    row.revision += 1
    await session.commit()
    return await get_match(row.id, _, session)


@router.delete("/matches/{match_id}", status_code=204)
async def delete_match(match_id: str, _: AdminUser, session: SessionDep) -> Response:
    row = await session.get(Match, match_id)
    if not row:
        raise api_error(404, "match_not_found", "Match not found.")
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)
