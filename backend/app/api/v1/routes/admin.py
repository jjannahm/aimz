from fastapi import APIRouter, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, SessionDep
from app.core.errors import api_error
from app.core.security import hash_password, secret_hash
from app.db.models import RegistrationInvite, User
from app.schemas import (
    AdminUserCreate,
    InviteCreate,
    InviteRead,
    Page,
    UserRead,
)

router = APIRouter()


@router.get("/users", response_model=Page[UserRead])
async def list_users(
    _: AdminUser,
    session: SessionDep,
    limit: int = 50,
    offset: int = 0,
) -> Page[UserRead]:
    limit = min(max(limit, 1), 100)
    total = await session.scalar(select(func.count()).select_from(User)) or 0
    users = list(
        (await session.scalars(select(User).order_by(User.name).limit(limit).offset(offset))).all()
    )
    return Page(
        items=[UserRead.model_validate(user) for user in users],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(payload: AdminUserCreate, _: AdminUser, session: SessionDep) -> User:
    user = User(
        name=payload.name.strip(),
        email=str(payload.email).lower(),
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise api_error(409, "email_in_use", "An account already uses that email.") from exc
    await session.refresh(user)
    return user


@router.get("/registration-invites", response_model=list[InviteRead])
async def list_invites(_: AdminUser, session: SessionDep) -> list[RegistrationInvite]:
    return list(
        (
            await session.scalars(
                select(RegistrationInvite).order_by(RegistrationInvite.created_at.desc())
            )
        ).all()
    )


@router.post(
    "/registration-invites", response_model=InviteRead, status_code=status.HTTP_201_CREATED
)
async def create_invite(
    payload: InviteCreate, admin: AdminUser, session: SessionDep
) -> RegistrationInvite:
    invite = RegistrationInvite(
        label=payload.label,
        code_hash=secret_hash(payload.code),
        expires_at=payload.expires_at,
        max_uses=payload.max_uses,
        created_by_id=admin.id,
    )
    session.add(invite)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise api_error(409, "invite_exists", "That invitation code already exists.") from exc
    await session.refresh(invite)
    return invite


@router.delete("/registration-invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(invite_id: str, _: AdminUser, session: SessionDep) -> Response:
    invite = await session.get(RegistrationInvite, invite_id)
    if invite is None:
        raise api_error(404, "invite_not_found", "Invitation not found.")
    invite.is_active = False
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
