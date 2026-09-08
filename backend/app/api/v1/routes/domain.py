from datetime import UTC, datetime
from typing import Any, TypeVar

from fastapi import APIRouter, Response
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import AdminUser, CurrentUser, SessionDep
from app.core.errors import api_error
from app.db.models import (
    Competition,
    CompetitionStatus,
    Match,
    MatchPhase,
    MatchStatus,
    Player,
    Team,
)
from app.schemas import (
    CompetitionInput,
    CompetitionRead,
    MatchInput,
    MatchRead,
    NextSeasonInput,
    Page,
    PlayerInput,
    PlayerRead,
    TeamInput,
    TeamRead,
)
from app.services.audit import record_audit
from app.services.competitions import require_open_competition
from app.services.knockout import generate_structure
from app.services.knockout_shape import Shape, ShapeError, resolve_shape
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


def _resolve_shape_or_422(payload: CompetitionInput) -> Shape:
    try:
        return resolve_shape(payload.team_count, payload.group_size)
    except ShapeError as exc:
        raise api_error(
            422,
            "validation_error",
            "Check the highlighted fields.",
            field_errors=[{"field": exc.field, "message": exc.message}],
        ) from exc


@router.post("/competitions", response_model=CompetitionRead, status_code=201)
async def create_competition(
    payload: CompetitionInput, _: AdminUser, session: SessionDep
) -> Competition:
    shape = _resolve_shape_or_422(payload)
    data = payload.model_dump()
    data["team_count"], data["group_size"] = shape.team_count, shape.group_size
    row = Competition(**data)
    session.add(row)
    await commit_or_conflict(session, "A competition with that name and season already exists.")
    # A knockout starts life with its groups and an empty bracket.
    if shape.team_count is not None:
        generate_structure(session, row, shape.team_count, shape.group_size)
        await session.commit()
    await session.refresh(row)
    return row


@router.patch("/competitions/{competition_id}", response_model=CompetitionRead)
async def update_competition(
    competition_id: str, payload: CompetitionInput, _: AdminUser, session: SessionDep
) -> Competition:
    row = await session.get(Competition, competition_id)
    if not row:
        raise api_error(404, "competition_not_found", "Competition not found.")
    shape = _resolve_shape_or_422(payload)
    had_structure = row.team_count is not None
    data = payload.model_dump()
    data["team_count"], data["group_size"] = shape.team_count, shape.group_size
    for field, value in data.items():
        setattr(row, field, value)
    await commit_or_conflict(session, "A competition with that name and season already exists.")
    # Generate the structure the first time a competition becomes a knockout;
    # an existing bracket is left in place rather than torn down under a season.
    if shape.team_count is not None and not had_structure:
        generate_structure(session, row, shape.team_count, shape.group_size)
        await session.commit()
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


async def _competition_or_404(session: SessionDep, competition_id: str) -> Competition:
    row = await session.get(Competition, competition_id)
    if row is None:
        raise api_error(404, "competition_not_found", "Competition not found.")
    return row


@router.post("/competitions/{competition_id}/complete", response_model=CompetitionRead)
async def complete_season(
    competition_id: str, admin: AdminUser, session: SessionDep
) -> Competition:
    """Close a season. Nothing is deleted or moved — the table, results,
    statistics and bracket stay exactly as they are, and the season simply stops
    accepting anything new. A match still being played is refused, because a live
    match in a finished season is a contradiction rather than an archive."""
    competition = await _competition_or_404(session, competition_id)
    if competition.status == CompetitionStatus.completed:
        return competition
    live = await session.scalar(
        select(Match.id).where(
            Match.competition_id == competition_id, Match.status == MatchStatus.live
        )
    )
    if live is not None:
        raise api_error(
            409,
            "match_in_progress",
            "Finish the match still being played before ending this season.",
        )
    competition.status = CompetitionStatus.completed
    competition.completed_at = datetime.now(UTC)
    record_audit(
        session,
        admin,
        action="season_completed",
        entity_type="competition",
        entity_id=competition.id,
        summary=f"Ended {competition.name} {competition.season}.",
    )
    await session.commit()
    await session.refresh(competition)
    return competition


@router.post("/competitions/{competition_id}/reopen", response_model=CompetitionRead)
async def reopen_season(
    competition_id: str, admin: AdminUser, session: SessionDep
) -> Competition:
    """Put a closed season back into play, which is the only way to score into it
    again."""
    competition = await _competition_or_404(session, competition_id)
    competition.status = CompetitionStatus.active
    competition.completed_at = None
    record_audit(
        session,
        admin,
        action="season_reopened",
        entity_type="competition",
        entity_id=competition.id,
        summary=f"Reopened {competition.name} {competition.season}.",
    )
    await session.commit()
    await session.refresh(competition)
    return competition


@router.post(
    "/competitions/{competition_id}/next-season",
    response_model=CompetitionRead,
    status_code=201,
)
async def start_next_season(
    competition_id: str,
    payload: NextSeasonInput,
    admin: AdminUser,
    session: SessionDep,
) -> Competition:
    """Start the next season of the same competition.

    A new row, sharing the name that ties the seasons together and carrying the
    same format. The season it follows is left untouched — its teams, matches and
    table still point at it, which keeps the history intact. ``carry_teams``
    copies the club list across as new rows for the new season; players are not,
    because a squad is not the same people a year later.
    """
    previous = await _competition_or_404(session, competition_id)
    if payload.season == previous.season:
        raise api_error(
            422, "same_season", "The next season must be named differently from this one."
        )
    nxt = Competition(
        name=previous.name,
        season=payload.season,
        type=previous.type,
        team_count=previous.team_count,
        group_size=previous.group_size,
        status=CompetitionStatus.active,
    )
    session.add(nxt)
    await commit_or_conflict(session, "A competition with that name and season already exists.")
    if nxt.team_count is not None and nxt.group_size is not None:
        generate_structure(session, nxt, nxt.team_count, nxt.group_size)
    if payload.carry_teams:
        carried = list(
            (
                await session.scalars(
                    select(Team)
                    .where(Team.competition_id == previous.id)
                    .order_by(Team.name)
                )
            ).all()
        )
        for team in carried:
            session.add(
                Team(
                    name=team.name,
                    squad_code=team.squad_code,
                    age_group=team.age_group,
                    season=payload.season,
                    is_aimz=team.is_aimz,
                    is_active=True,
                    logo_key=team.logo_key,
                    badge_style=team.badge_style,
                    coach=team.coach,
                    assistant_coach=team.assistant_coach,
                    competition_id=nxt.id,
                )
            )
    record_audit(
        session,
        admin,
        action="season_started",
        entity_type="competition",
        entity_id=nxt.id,
        summary=f"Started {nxt.name} {payload.season}.",
    )
    await session.commit()
    await session.refresh(nxt)
    return nxt


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
    # A finished season takes nothing new; a fixture cannot be added to it.
    require_open_competition(await session.get(Competition, payload.competition_id))
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
    if next_status != row.status:
        from app.services.scoring import opponent_only_match

        if await opponent_only_match(session, row):
            raise api_error(
                409,
                "opponent_only_match",
                "This match is between two opponent teams. Enter the final score instead.",
            )
    for field, value in payload.model_dump(exclude={"status"}).items():
        setattr(row, field, value)
    apply_legacy_status_change(row, next_status)
    row.revision += 1
    # Once the match is under way, settle who took the field and what the keepers
    # are answerable for — appearances from the sheet, goals conceded against
    # whichever keeper was on, and, on finishing, clean sheets. A no-op while
    # still scheduled and for a match with no team sheet.
    from app.services.scoring import recompute_pitch_stats

    await recompute_pitch_stats(session, row)
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
