from datetime import datetime

from fastapi import APIRouter, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, SessionDep, TeamOperator
from app.core.errors import api_error
from app.db.models import (
    Player,
    TrainingAvailability,
    TrainingSession,
    User,
    UserRole,
    new_id,
)
from app.schemas import (
    AvailabilityInput,
    AvailabilityRead,
    Page,
    PlayerRead,
    TeamRead,
    TrainingCreate,
    TrainingSessionRead,
    TrainingUpdate,
)
from app.services.team_access import (
    can_open_team,
    require_team_operator,
    scoped_teams,
)

router = APIRouter()


def _page_args(limit: int, offset: int) -> tuple[int, int]:
    return min(max(limit, 1), 100), max(offset, 0)


def _serialize(row: TrainingSession) -> TrainingSessionRead:
    data = TrainingSessionRead.model_validate(row)
    data.team = TeamRead.model_validate(row.team) if row.team else None
    return data


async def _session_or_404(session: SessionDep, training_id: str) -> TrainingSession:
    row = await session.scalar(
        select(TrainingSession)
        .where(TrainingSession.id == training_id)
        .options(selectinload(TrainingSession.team))
    )
    if row is None:
        raise api_error(404, "training_not_found", "Training session not found.")
    return row


async def _require_access(session: SessionDep, user: User, row: TrainingSession) -> None:
    if user.role == UserRole.admin:
        return
    if not await can_open_team(session, user, row.team_id):
        raise api_error(
            403,
            "team_access_denied",
            "You can only open your own squad's training sessions.",
        )


@router.get("/training-sessions", response_model=Page[TrainingSessionRead])
async def list_training(
    current_user: CurrentUser,
    session: SessionDep,
    team_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
) -> Page[TrainingSessionRead]:
    team_ids = await scoped_teams(session, current_user, team_id)
    limit, offset = _page_args(limit, offset)
    query = select(TrainingSession).options(selectinload(TrainingSession.team))
    count_query = select(func.count()).select_from(TrainingSession)
    conditions = [
        TrainingSession.team_id.in_(team_ids) if team_ids is not None else None,
        TrainingSession.starts_at >= date_from if date_from else None,
        TrainingSession.starts_at <= date_to if date_to else None,
    ]
    for condition in conditions:
        if condition is not None:
            query, count_query = query.where(condition), count_query.where(condition)
    total = await session.scalar(count_query) or 0
    rows = (
        await session.scalars(query.order_by(TrainingSession.starts_at).limit(limit).offset(offset))
    ).all()
    return Page(items=[_serialize(row) for row in rows], total=total, limit=limit, offset=offset)


@router.get("/training-sessions/{training_id}", response_model=TrainingSessionRead)
async def get_training(
    training_id: str, current_user: CurrentUser, session: SessionDep
) -> TrainingSessionRead:
    row = await _session_or_404(session, training_id)
    await _require_access(session, current_user, row)
    return _serialize(row)


@router.post("/training-sessions", response_model=list[TrainingSessionRead], status_code=201)
async def create_training(
    payload: TrainingCreate, actor: TeamOperator, session: SessionDep
) -> list[TrainingSessionRead]:
    await require_team_operator(session, actor, payload.team_id)
    # Dedupe and order the occurrences; a recurring block shares one series id.
    occurrences = sorted(set(payload.occurrences))
    series_id = new_id() if len(occurrences) > 1 else None
    rows = [
        TrainingSession(
            team_id=payload.team_id,
            starts_at=starts_at,
            duration_minutes=payload.duration_minutes,
            venue=payload.venue,
            notes=payload.notes,
            series_id=series_id,
        )
        for starts_at in occurrences
    ]
    session.add_all(rows)
    await session.commit()
    ids = [row.id for row in rows]
    reloaded = (
        await session.scalars(
            select(TrainingSession)
            .where(TrainingSession.id.in_(ids))
            .options(selectinload(TrainingSession.team))
            .order_by(TrainingSession.starts_at)
        )
    ).all()
    return [_serialize(row) for row in reloaded]


@router.patch("/training-sessions/{training_id}", response_model=TrainingSessionRead)
async def update_training(
    training_id: str, payload: TrainingUpdate, actor: TeamOperator, session: SessionDep
) -> TrainingSessionRead:
    row = await _session_or_404(session, training_id)
    await require_team_operator(session, actor, row.team_id)
    provided = payload.model_fields_set
    if "starts_at" in provided and payload.starts_at is not None:
        row.starts_at = payload.starts_at
    if "duration_minutes" in provided and payload.duration_minutes is not None:
        row.duration_minutes = payload.duration_minutes
    if "venue" in provided and payload.venue is not None:
        row.venue = payload.venue
    if "notes" in provided:
        row.notes = payload.notes
    await session.commit()
    return _serialize(await _session_or_404(session, training_id))


@router.delete("/training-sessions/{training_id}", status_code=204)
async def delete_training(
    training_id: str,
    actor: TeamOperator,
    session: SessionDep,
    scope: str = "one",
) -> Response:
    if scope not in {"one", "series"}:
        raise api_error(422, "validation_error", "Delete one session or its whole series.")
    row = await _session_or_404(session, training_id)
    await require_team_operator(session, actor, row.team_id)
    if scope == "series" and row.series_id:
        await session.execute(
            delete(TrainingSession).where(TrainingSession.series_id == row.series_id)
        )
    else:
        await session.delete(row)
    await session.commit()
    return Response(status_code=204)


def _availability(row: TrainingAvailability, player: Player | None) -> AvailabilityRead:
    # Built field-by-field rather than model_validate so we never touch the
    # ``player`` relationship on ``row`` (which would trigger an async lazy load).
    return AvailabilityRead(
        id=row.id,
        training_session_id=row.training_session_id,
        player_id=row.player_id,
        status=row.status,
        note=row.note,
        created_at=row.created_at,
        updated_at=row.updated_at,
        player=PlayerRead.model_validate(player) if player else None,
    )


@router.get(
    "/training-sessions/{training_id}/availability",
    response_model=list[AvailabilityRead],
)
async def list_availability(
    training_id: str, current_user: CurrentUser, session: SessionDep
) -> list[AvailabilityRead]:
    row = await _session_or_404(session, training_id)
    await _require_access(session, current_user, row)
    entries = (
        await session.scalars(
            select(TrainingAvailability)
            .where(TrainingAvailability.training_session_id == training_id)
            .options(selectinload(TrainingAvailability.player))
            .order_by(TrainingAvailability.updated_at.desc())
        )
    ).all()
    return [_availability(entry, entry.player) for entry in entries]


@router.put(
    "/training-sessions/{training_id}/availability",
    response_model=AvailabilityRead,
)
async def set_availability(
    training_id: str,
    payload: AvailabilityInput,
    current_user: CurrentUser,
    session: SessionDep,
) -> AvailabilityRead:
    row = await _session_or_404(session, training_id)
    await _require_access(session, current_user, row)
    # An admin names the player; anyone else answers for their own linked player.
    if current_user.role == UserRole.admin:
        if not payload.player_id:
            raise api_error(422, "player_not_found", "Choose a player from this squad.")
        player_id = payload.player_id
    else:
        if current_user.player_id is None:
            raise api_error(422, "player_not_found", "Choose a player from this squad.")
        player_id = current_user.player_id
    player = await session.scalar(
        select(Player).where(Player.id == player_id, Player.team_id == row.team_id)
    )
    if player is None:
        raise api_error(422, "player_not_found", "Choose a player from this squad.")
    entry = await session.scalar(
        select(TrainingAvailability).where(
            TrainingAvailability.training_session_id == training_id,
            TrainingAvailability.player_id == player_id,
        )
    )
    if entry is None:
        entry = TrainingAvailability(training_session_id=training_id, player_id=player_id)
        session.add(entry)
    entry.status = payload.status
    entry.note = payload.note
    await session.commit()
    # Repopulate server-generated timestamps on a freshly-inserted row.
    await session.refresh(entry)
    return _availability(entry, player)
