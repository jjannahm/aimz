from fastapi import APIRouter, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, SessionDep
from app.core.errors import api_error
from app.core.security import hash_password, secret_hash
from app.db.models import AuditLog, Player, RegistrationInvite, Team, User
from app.schemas import (
    AdminAccountRead,
    AdminUserCreate,
    AdminUserUpdate,
    AuditLogRead,
    InviteCreate,
    InviteRead,
    Page,
    UserRead,
)

router = APIRouter()


async def claimable_player(
    session: SessionDep, player_id: str | None, except_user_id: str | None = None
) -> str | None:
    """The roster player an account may be pointed at, or None for no link.

    ``users.player_id`` is unique, so a player who already has an account cannot
    be given a second one. Refusing here says which player is taken; leaving it
    to the constraint would surface as a bare failed write.
    """
    if not player_id:
        return None
    if await session.get(Player, player_id) is None:
        raise api_error(422, "player_not_found", "Choose a player from the roster.")
    holder = await session.scalar(select(User.id).where(User.player_id == player_id))
    if holder is not None and holder != except_user_id:
        raise api_error(
            409, "player_already_linked", "Another account is already linked to that player."
        )
    return player_id


@router.get("/audit-log", response_model=Page[AuditLogRead])
async def list_audit_log(
    _: AdminUser,
    session: SessionDep,
    match_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> Page[AuditLogRead]:
    """Newest first, optionally narrowed to one match."""
    limit, offset = min(max(limit, 1), 100), max(offset, 0)
    counted = select(func.count()).select_from(AuditLog)
    query = select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id)
    if match_id:
        counted = counted.where(AuditLog.match_id == match_id)
        query = query.where(AuditLog.match_id == match_id)
    total = await session.scalar(counted) or 0
    entries = list((await session.scalars(query.limit(limit).offset(offset))).all())
    return Page(
        items=[AuditLogRead.model_validate(entry) for entry in entries],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/users", response_model=Page[AdminAccountRead])
async def list_users(
    _: AdminUser,
    session: SessionDep,
    limit: int = 50,
    offset: int = 0,
) -> Page[AdminAccountRead]:
    limit = min(max(limit, 1), 100)
    offset = max(offset, 0)
    total = await session.scalar(select(func.count()).select_from(User)) or 0
    rows = (
        await session.execute(
            select(User, Player, Team)
            .outerjoin(Player, Player.id == User.player_id)
            .outerjoin(Team, Team.id == Player.team_id)
            .order_by(User.name)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    accounts = [
        AdminAccountRead(
            **UserRead.model_validate(user).model_dump(),
            player=None if player is None else player,
            team=None if team is None else team,
        )
        for user, player, team in rows
    ]
    return Page(
        items=accounts,
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


@router.patch("/users/{user_id}", response_model=UserRead)
async def link_user_player(
    user_id: str, payload: AdminUserUpdate, _: AdminUser, session: SessionDep
) -> User:
    """Point an account at the roster player whose stats are its own.

    Personal invitations cover accounts made from here on; this covers the ones
    that already exist, and the times a link was made against the wrong player.
    Passing null unlinks.
    """
    user = await session.get(User, user_id)
    if user is None:
        raise api_error(404, "user_not_found", "Account not found.")
    user.player_id = await claimable_player(session, payload.player_id, user.id)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise api_error(
            409,
            "player_already_linked",
            "Another account is already linked to that player.",
        ) from exc
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
    player_id = await claimable_player(session, payload.player_id)
    invite = RegistrationInvite(
        label=payload.label,
        code_hash=secret_hash(payload.code),
        player_id=player_id,
        expires_at=payload.expires_at,
        # An invitation cut for one named player is for that one person, whatever
        # the caller asks for: a second claim would find the roster record taken.
        max_uses=1 if player_id else payload.max_uses,
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
