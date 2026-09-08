from fastapi import APIRouter, Response
from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import selectinload

from app.api.deps import AdminUser, CurrentUser, SessionDep
from app.core.errors import api_error
from app.db.models import (
    EventAssignment,
    Match,
    Player,
    TrainingSession,
    User,
    UserRole,
)
from app.schemas import (
    AssignmentCreate,
    AssignmentRead,
    AssignmentUpdate,
    PlayerRead,
)
from app.services.team_access import can_open_team

router = APIRouter()

_LOAD = selectinload(EventAssignment.assigned_player)


def _serialize(row: EventAssignment) -> AssignmentRead:
    return AssignmentRead(
        id=row.id,
        match_id=row.match_id,
        training_session_id=row.training_session_id,
        title=row.title,
        assigned_player_id=row.assigned_player_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        assigned_player=(
            PlayerRead.model_validate(row.assigned_player)
            if row.assigned_player
            else None
        ),
    )


async def _reload(session: SessionDep, assignment_id: str) -> EventAssignment:
    row = await session.scalar(
        select(EventAssignment)
        .where(EventAssignment.id == assignment_id)
        .options(_LOAD)
    )
    assert row is not None
    return row


async def _match_or_404(session: SessionDep, match_id: str) -> Match:
    match = await session.scalar(
        select(Match)
        .where(Match.id == match_id)
        .options(selectinload(Match.home_team), selectinload(Match.away_team))
    )
    if match is None:
        raise api_error(404, "match_not_found", "Match not found.")
    return match


async def _training_or_404(session: SessionDep, training_id: str) -> TrainingSession:
    row = await session.get(TrainingSession, training_id)
    if row is None:
        raise api_error(404, "training_not_found", "Training session not found.")
    return row


async def _eligible_player(
    session: SessionDep,
    *,
    match_id: str | None,
    training_session_id: str | None,
    player_id: str,
) -> Player:
    """The player must exist and belong to the AIMZ squad this job is for."""
    player = await session.get(Player, player_id)
    if player is None:
        raise api_error(422, "player_not_found", "Choose a roster player.")
    if training_session_id:
        ts = await _training_or_404(session, training_session_id)
        if player.team_id != ts.team_id:
            raise api_error(
                422,
                "assignment_player_ineligible",
                "Choose a player from the training squad.",
            )
    elif match_id:
        match = await _match_or_404(session, match_id)
        eligible = (
            player.team_id == match.home_team_id and match.home_team.is_aimz
        ) or (player.team_id == match.away_team_id and match.away_team.is_aimz)
        if not eligible:
            raise api_error(
                422,
                "assignment_player_ineligible",
                "Choose a player from an AIMZ squad in this match.",
            )
    return player


async def _create(
    session: SessionDep,
    payload: AssignmentCreate,
    *,
    match_id: str | None,
    training_session_id: str | None,
) -> AssignmentRead:
    if match_id:
        await _match_or_404(session, match_id)
    if training_session_id:
        await _training_or_404(session, training_session_id)
    if payload.assigned_player_id:
        await _eligible_player(
            session,
            match_id=match_id,
            training_session_id=training_session_id,
            player_id=payload.assigned_player_id,
        )
    row = EventAssignment(
        match_id=match_id,
        training_session_id=training_session_id,
        title=payload.title,
        assigned_player_id=payload.assigned_player_id,
    )
    session.add(row)
    await session.commit()
    return _serialize(await _reload(session, row.id))


async def _assignment_or_404(session: SessionDep, assignment_id: str) -> EventAssignment:
    row = await session.get(EventAssignment, assignment_id)
    if row is None:
        raise api_error(404, "assignment_not_found", "Assignment not found.")
    return row


# --- Match assignments -----------------------------------------------------


@router.get("/matches/{match_id}/assignments", response_model=list[AssignmentRead])
async def list_match_assignments(
    match_id: str, _: CurrentUser, session: SessionDep
) -> list[AssignmentRead]:
    await _match_or_404(session, match_id)
    rows = (
        await session.scalars(
            select(EventAssignment)
            .where(EventAssignment.match_id == match_id)
            .options(_LOAD)
            .order_by(EventAssignment.created_at)
        )
    ).all()
    return [_serialize(row) for row in rows]


@router.post(
    "/matches/{match_id}/assignments",
    response_model=AssignmentRead,
    status_code=201,
)
async def create_match_assignment(
    match_id: str, payload: AssignmentCreate, _: AdminUser, session: SessionDep
) -> AssignmentRead:
    return await _create(session, payload, match_id=match_id, training_session_id=None)


@router.delete(
    "/matches/{match_id}/assignments/{assignment_id}", status_code=204
)
async def delete_match_assignment(
    match_id: str, assignment_id: str, _: AdminUser, session: SessionDep
) -> Response:
    row = await session.scalar(
        select(EventAssignment).where(
            EventAssignment.id == assignment_id,
            EventAssignment.match_id == match_id,
        )
    )
    if row is None:
        raise api_error(404, "assignment_not_found", "Assignment not found.")
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)


# --- Training assignments --------------------------------------------------


async def _require_training_access(
    session: SessionDep, user: User, training_id: str
) -> None:
    ts = await _training_or_404(session, training_id)
    if user.role == UserRole.admin:
        return
    if not await can_open_team(session, user, ts.team_id):
        raise api_error(
            403,
            "team_access_denied",
            "You can only open your own squad's training sessions.",
        )


@router.get(
    "/training-sessions/{training_id}/assignments",
    response_model=list[AssignmentRead],
)
async def list_training_assignments(
    training_id: str, current_user: CurrentUser, session: SessionDep
) -> list[AssignmentRead]:
    await _require_training_access(session, current_user, training_id)
    rows = (
        await session.scalars(
            select(EventAssignment)
            .where(EventAssignment.training_session_id == training_id)
            .options(_LOAD)
            .order_by(EventAssignment.created_at)
        )
    ).all()
    return [_serialize(row) for row in rows]


@router.post(
    "/training-sessions/{training_id}/assignments",
    response_model=AssignmentRead,
    status_code=201,
)
async def create_training_assignment(
    training_id: str, payload: AssignmentCreate, _: AdminUser, session: SessionDep
) -> AssignmentRead:
    return await _create(
        session, payload, match_id=None, training_session_id=training_id
    )


@router.delete(
    "/training-sessions/{training_id}/assignments/{assignment_id}",
    status_code=204,
)
async def delete_training_assignment(
    training_id: str, assignment_id: str, _: AdminUser, session: SessionDep
) -> Response:
    row = await session.scalar(
        select(EventAssignment).where(
            EventAssignment.id == assignment_id,
            EventAssignment.training_session_id == training_id,
        )
    )
    if row is None:
        raise api_error(404, "assignment_not_found", "Assignment not found.")
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)


# --- Claim / release -------------------------------------------------------


async def _access_assignment(
    session: SessionDep, user: User, row: EventAssignment
) -> None:
    if user.role == UserRole.admin or not row.training_session_id:
        return
    await _require_training_access(session, user, row.training_session_id)


@router.patch("/event-assignments/{assignment_id}", response_model=AssignmentRead)
async def update_assignment(
    assignment_id: str,
    payload: AssignmentUpdate,
    current_user: CurrentUser,
    session: SessionDep,
) -> AssignmentRead:
    row = await _assignment_or_404(session, assignment_id)
    await _access_assignment(session, current_user, row)
    requested = payload.assigned_player_id

    if current_user.role == UserRole.admin:
        if requested:
            await _eligible_player(
                session,
                match_id=row.match_id,
                training_session_id=row.training_session_id,
                player_id=requested,
            )
        row.assigned_player_id = requested
        await session.commit()
        return _serialize(await _reload(session, row.id))

    # Non-admins may only sign themselves up or release their own claim.
    if requested is not None and requested != current_user.player_id:
        raise api_error(403, "assignment_self_only", "You can only sign up yourself.")
    if current_user.player_id is None:
        raise api_error(
            403,
            "player_link_required",
            "Ask an AIMZ administrator to link your account before signing up.",
        )
    await _eligible_player(
        session,
        match_id=row.match_id,
        training_session_id=row.training_session_id,
        player_id=current_user.player_id,
    )

    if requested:
        # Optimistic claim: only succeeds if the job is free or already mine.
        result = await session.execute(
            update(EventAssignment)
            .where(
                EventAssignment.id == row.id,
                or_(
                    EventAssignment.assigned_player_id.is_(None),
                    EventAssignment.assigned_player_id == current_user.player_id,
                ),
            )
            .values(assigned_player_id=current_user.player_id)
        )
        if result.rowcount == 0:
            raise api_error(
                409, "assignment_taken", "Another player has already signed up."
            )
    else:
        # Release only what I hold.
        result = await session.execute(
            update(EventAssignment)
            .where(
                and_(
                    EventAssignment.id == row.id,
                    EventAssignment.assigned_player_id == current_user.player_id,
                )
            )
            .values(assigned_player_id=None)
        )
        if result.rowcount == 0:
            raise api_error(
                403,
                "assignment_release_denied",
                "You can only release an assignment you hold.",
            )
    await session.commit()
    return _serialize(await _reload(session, row.id))
