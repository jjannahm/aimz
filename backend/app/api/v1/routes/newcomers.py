from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, SessionDep
from app.core.config import settings
from app.core.errors import api_error
from app.db.models import (
    InviteKind,
    NewcomerApplication,
    NewcomerNote,
    NewcomerOutcome,
    NewcomerRateLimit,
    NewcomerSource,
    NewcomerStage,
    OnboardingStatus,
    Player,
    PlayerContact,
    RegistrationInvite,
    Team,
    User,
)
from app.schemas import (
    GeneratedInviteRead,
    NewcomerApplicationInput,
    NewcomerAssignment,
    NewcomerAssignmentResult,
    NewcomerCreated,
    NewcomerNoteCreate,
    NewcomerNoteRead,
    NewcomerRead,
    NewcomerUpdate,
    Page,
    PublicNewcomerCreate,
)
from app.services.invitations import unique_invite_code
from app.services.turnstile import verify_newcomer_token

public_router = APIRouter()
admin_router = APIRouter()


def application_values(payload: NewcomerApplicationInput) -> dict[str, object]:
    values = {
        key: getattr(payload, key)
        for key in NewcomerApplicationInput.model_fields
        if key != "consent"
    }
    values["email"] = str(payload.email).lower()
    values["date_of_birth"] = payload.date_of_birth.isoformat()
    values["consented_at"] = datetime.now(UTC)
    return values


async def is_duplicate(session: SessionDep, item: NewcomerApplication) -> bool:
    return bool(
        await session.scalar(
            select(NewcomerApplication.id)
            .where(
                NewcomerApplication.id != item.id,
                or_(
                    func.lower(NewcomerApplication.email) == item.email.lower(),
                    NewcomerApplication.mobile == item.mobile,
                    NewcomerApplication.whatsapp_mobile == item.whatsapp_mobile,
                ),
            )
            .limit(1)
        )
    )


async def newcomer_read(
    session: SessionDep, item: NewcomerApplication, *, include_notes: bool = False
) -> NewcomerRead:
    notes: list[NewcomerNote] = []
    if include_notes:
        notes = list(
            (
                await session.scalars(
                    select(NewcomerNote)
                    .where(NewcomerNote.application_id == item.id)
                    .order_by(NewcomerNote.created_at.desc())
                )
            ).all()
        )
    values = NewcomerRead.model_validate(item).model_dump()
    values["duplicate_likely"] = await is_duplicate(session, item)
    values["notes"] = [NewcomerNoteRead.model_validate(note) for note in notes]
    return NewcomerRead(**values)


async def enforce_rate_limit(session: SessionDep, remote_ip: str) -> None:
    now = datetime.now(UTC)
    window = now - timedelta(minutes=15)
    digest = hashlib.sha256(f"{settings.jwt_secret}:{remote_ip}".encode()).hexdigest()
    row = await session.scalar(
        select(NewcomerRateLimit).where(NewcomerRateLimit.key_hash == digest).with_for_update()
    )
    if row is None:
        session.add(NewcomerRateLimit(key_hash=digest, window_started_at=now, attempts=1))
    elif row.window_started_at.replace(
        tzinfo=row.window_started_at.tzinfo or UTC
    ) < window:
        row.window_started_at = now
        row.attempts = 1
    elif row.attempts >= 5:
        raise api_error(429, "rate_limited", "Too many applications. Try again in 15 minutes.")
    else:
        row.attempts += 1


@public_router.post(
    "/newcomer-applications",
    response_model=NewcomerCreated,
    status_code=status.HTTP_201_CREATED,
)
async def submit_public_application(
    payload: PublicNewcomerCreate, request: Request, session: SessionDep
) -> NewcomerCreated:
    existing = await session.scalar(
        select(NewcomerApplication).where(
            NewcomerApplication.client_submission_id == payload.client_submission_id
        )
    )
    if existing is not None:
        return NewcomerCreated(
            id=existing.id,
            stage=existing.stage,
            duplicate_likely=await is_duplicate(session, existing),
        )
    remote_ip = request.client.host if request.client else "unknown"
    await verify_newcomer_token(payload.turnstile_token, remote_ip)
    await enforce_rate_limit(session, remote_ip)
    item = NewcomerApplication(
        source=NewcomerSource.public_link,
        client_submission_id=payload.client_submission_id,
        **application_values(payload),
    )
    session.add(item)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await session.scalar(
            select(NewcomerApplication).where(
                NewcomerApplication.client_submission_id == payload.client_submission_id
            )
        )
        if existing is None:
            raise
        item = existing
    await session.refresh(item)
    return NewcomerCreated(
        id=item.id, stage=item.stage, duplicate_likely=await is_duplicate(session, item)
    )


@admin_router.get("/newcomers", response_model=Page[NewcomerRead])
async def list_newcomers(
    _: AdminUser,
    session: SessionDep,
    queue: str = "active",
    search: str | None = None,
    branch: str | None = None,
    source: NewcomerSource | None = None,
    stage: NewcomerStage | None = None,
    limit: int = 50,
    offset: int = 0,
) -> Page[NewcomerRead]:
    limit, offset = min(max(limit, 1), 100), max(offset, 0)
    conditions = [
        NewcomerApplication.stage != NewcomerStage.closed
        if queue == "active"
        else NewcomerApplication.stage == NewcomerStage.closed
    ]
    if search:
        needle = f"%{search.strip()}%"
        conditions.append(
            or_(
                NewcomerApplication.full_name.ilike(needle),
                NewcomerApplication.email.ilike(needle),
                NewcomerApplication.mobile.ilike(needle),
                NewcomerApplication.whatsapp_mobile.ilike(needle),
            )
        )
    if branch:
        conditions.append(NewcomerApplication.branch == branch)
    if source:
        conditions.append(NewcomerApplication.source == source)
    if stage:
        conditions.append(NewcomerApplication.stage == stage)
    total = (
        await session.scalar(
            select(func.count()).select_from(NewcomerApplication).where(*conditions)
        )
        or 0
    )
    items = list(
        (
            await session.scalars(
                select(NewcomerApplication)
                .where(*conditions)
                .order_by(
                    NewcomerApplication.next_follow_up_at.asc().nullslast(),
                    NewcomerApplication.created_at.desc(),
                )
                .limit(limit)
                .offset(offset)
            )
        ).all()
    )
    return Page(
        items=[await newcomer_read(session, item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


async def get_application(session: SessionDep, application_id: str) -> NewcomerApplication:
    item = await session.get(NewcomerApplication, application_id)
    if item is None:
        raise api_error(404, "newcomer_not_found", "Newcomer application not found.")
    return item


@admin_router.get("/newcomers/{application_id}", response_model=NewcomerRead)
async def newcomer_detail(application_id: str, _: AdminUser, session: SessionDep) -> NewcomerRead:
    return await newcomer_read(
        session, await get_application(session, application_id), include_notes=True
    )


@admin_router.patch("/newcomers/{application_id}", response_model=NewcomerRead)
async def update_newcomer(
    application_id: str, payload: NewcomerUpdate, admin: AdminUser, session: SessionDep
) -> NewcomerRead:
    item = await get_application(session, application_id)
    for field in payload.model_fields_set:
        setattr(item, field, getattr(payload, field))
    if payload.outcome is not None:
        item.stage = NewcomerStage.closed
    if item.stage == NewcomerStage.closed:
        if item.outcome is None:
            raise api_error(422, "outcome_required", "Choose a closed outcome.")
        item.closed_at = datetime.now(UTC)
        item.next_follow_up_at = None
        if item.user_id and item.outcome != NewcomerOutcome.joined:
            user = await session.get(User, item.user_id)
            if user:
                user.onboarding_status = OnboardingStatus.declined
    else:
        item.outcome = None
        item.closed_at = None
    item.reviewed_by_id = admin.id
    await session.commit()
    await session.refresh(item)
    return await newcomer_read(session, item, include_notes=True)


@admin_router.post(
    "/newcomers/{application_id}/notes",
    response_model=NewcomerNoteRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_newcomer_note(
    application_id: str, payload: NewcomerNoteCreate, admin: AdminUser, session: SessionDep
) -> NewcomerNote:
    await get_application(session, application_id)
    note = NewcomerNote(
        application_id=application_id, author_id=admin.id, body=payload.body.strip()
    )
    session.add(note)
    await session.commit()
    await session.refresh(note)
    return note


@admin_router.post(
    "/newcomers/{application_id}/assign-and-confirm",
    response_model=NewcomerAssignmentResult,
)
async def assign_and_confirm(
    application_id: str, payload: NewcomerAssignment, admin: AdminUser, session: SessionDep
) -> NewcomerAssignmentResult:
    item = await get_application(session, application_id)
    team = await session.get(Team, payload.team_id)
    if team is None or not team.is_aimz or not team.is_active:
        raise api_error(422, "team_not_found", "Choose an active AIMZ squad.")
    if payload.jersey_number is not None and await session.scalar(
        select(Player.id).where(
            Player.team_id == team.id,
            Player.jersey_number == payload.jersey_number,
            Player.id != item.player_id,
        )
    ):
        raise api_error(409, "jersey_in_use", "That jersey number is already used in this squad.")

    player = await session.get(Player, item.player_id) if item.player_id else None
    if player is None:
        player = Player(
            name=item.full_name,
            team_id=team.id,
            position=payload.position,
            jersey_number=payload.jersey_number,
            date_of_birth=item.date_of_birth,
        )
        session.add(player)
        await session.flush()
        session.add_all(
            [
                PlayerContact(
                    player_id=player.id,
                    name=item.father_name,
                    relationship="father",
                    phone=item.father_mobile,
                ),
                PlayerContact(
                    player_id=player.id,
                    name=item.mother_name,
                    relationship="mother",
                    phone=item.mother_mobile,
                ),
            ]
        )
    else:
        player.team_id = team.id
        player.position = payload.position
        player.jersey_number = payload.jersey_number
        player.date_of_birth = item.date_of_birth
    item.player_id = player.id
    item.suggested_team_id = team.id
    item.stage = NewcomerStage.closed
    item.outcome = NewcomerOutcome.joined
    item.closed_at = datetime.now(UTC)
    item.next_follow_up_at = None
    item.reviewed_by_id = admin.id

    invitation: GeneratedInviteRead | None = None
    user = await session.get(User, item.user_id) if item.user_id else None
    if user:
        if user.player_id not in {None, player.id}:
            raise api_error(
                409, "player_already_linked", "The account is linked to another player."
            )
        user.player_id = player.id
        user.onboarding_status = OnboardingStatus.approved
    else:
        code, code_hash = await unique_invite_code(session)
        invite = RegistrationInvite(
            label=f"{item.full_name} — {team.name}",
            code_hash=code_hash,
            kind=InviteKind.player,
            player_id=player.id,
            team_id=team.id,
            application_id=item.id,
            max_uses=1,
            created_by_id=admin.id,
        )
        session.add(invite)
        await session.flush()
        item.invite_id = invite.id
        compact = code.replace("-", "")
        invitation = GeneratedInviteRead(
            id=invite.id,
            label=invite.label,
            kind=invite.kind,
            player_id=invite.player_id,
            team_id=invite.team_id,
            application_id=invite.application_id,
            players=[],
            expires_at=None,
            max_uses=1,
            use_count=0,
            is_active=True,
            created_at=invite.created_at,
            code=code,
            share_url=f"{settings.public_web_origin}/join/{compact}",
        )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise api_error(
            409, "assignment_conflict", "The squad assignment conflicts with existing data."
        ) from exc
    await session.refresh(item)
    return NewcomerAssignmentResult(
        application=await newcomer_read(session, item, include_notes=True),
        player_id=player.id,
        invitation=invitation,
    )


@admin_router.delete("/newcomers/{application_id}/personal-data", status_code=204)
async def redact_newcomer(application_id: str, _: AdminUser, session: SessionDep) -> Response:
    item = await get_application(session, application_id)
    marker = "[redacted]"
    for field in (
        "branch",
        "full_name",
        "mobile",
        "whatsapp_mobile",
        "nationality",
        "address",
        "previous_academy",
        "school_university",
        "father_name",
        "father_mobile",
        "mother_name",
        "mother_mobile",
        "medical_concerns",
        "medications",
    ):
        setattr(item, field, marker)
    item.email = f"redacted-{item.id}@invalid.local"
    item.date_of_birth = "1900-01-01"
    item.redacted_at = datetime.now(UTC)
    notes = await session.scalars(
        select(NewcomerNote).where(NewcomerNote.application_id == item.id)
    )
    for note in notes:
        note.body = marker
    await session.commit()
    return Response(status_code=204)
