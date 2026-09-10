from fastapi import APIRouter, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, SessionDep
from app.core.config import settings
from app.core.errors import api_error
from app.core.security import hash_password, secret_hash
from app.db.models import (
    AuditLog,
    InviteKind,
    InvitePlayer,
    Player,
    RegistrationInvite,
    Team,
    User,
    UserChild,
)
from app.schemas import (
    AdminAccountRead,
    AdminUserCreate,
    AdminUserUpdate,
    AuditLogRead,
    ChildRead,
    GeneratedInviteRead,
    InviteCreate,
    InvitePlayerRead,
    InviteRead,
    Page,
    UserRead,
)
from app.services.accounts import set_account_expiry, validate_expiry
from app.services.invitations import invite_hash_candidates, unique_invite_code

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


async def roster_player(session: SessionDep, player_id: str) -> str:
    """A roster player, without claiming them: several parents may name one
    child, so a parent invitation checks the record exists but does not reserve
    it the way a player invitation does."""
    if await session.get(Player, player_id) is None:
        raise api_error(422, "player_not_found", "Choose a player from the roster.")
    return player_id


async def invite_read(session: SessionDep, invite: RegistrationInvite) -> InviteRead:
    """An invitation with the players it names read alongside it."""
    rows = (
        await session.execute(
            select(Player.id, Player.name)
            .join(InvitePlayer, InvitePlayer.player_id == Player.id)
            .where(InvitePlayer.invite_id == invite.id)
            .order_by(Player.name)
        )
    ).all()
    return InviteRead(
        id=invite.id,
        label=invite.label,
        kind=invite.kind,
        player_id=invite.player_id,
        team_id=invite.team_id,
        application_id=invite.application_id,
        players=[InvitePlayerRead(id=pid, name=name) for pid, name in rows],
        expires_at=invite.expires_at,
        max_uses=invite.max_uses,
        use_count=invite.use_count,
        is_active=invite.is_active,
        created_at=invite.created_at,
    )


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
    # A parent's roster links live in user_children, never on users.player_id, so
    # the join above reports every parent as unlinked. Their children are read
    # alongside and grouped here, the way the invitations list does.
    user_ids = [user.id for user, _player, _team in rows]
    children: dict[str, list[ChildRead]] = {}
    if user_ids:
        child_rows = (
            await session.execute(
                select(UserChild.user_id, Player.id, Player.name, Player.team_id, Team.name)
                .join(Player, Player.id == UserChild.player_id)
                .outerjoin(Team, Team.id == Player.team_id)
                .where(UserChild.user_id.in_(user_ids))
                .order_by(Player.name)
            )
        ).all()
        for uid, pid, name, team_id, team_name in child_rows:
            children.setdefault(uid, []).append(
                ChildRead(id=pid, name=name, team_id=team_id, team_name=team_name)
            )
    accounts = [
        AdminAccountRead(
            **UserRead.model_validate(user).model_dump(),
            player=None if player is None else player,
            team=None if team is None else team,
            children=children.get(user.id, []),
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
    expires_at = validate_expiry(payload.expires_at)
    user = User(
        name=payload.name.strip(),
        email=str(payload.email).lower(),
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise api_error(409, "email_in_use", "An account already uses that email.") from exc
    if expires_at is not None:
        await set_account_expiry(session, user, expires_at)
    await session.commit()
    await session.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str, payload: AdminUserUpdate, _: AdminUser, session: SessionDep
) -> User:
    """Point an account at the roster player whose stats are its own, or set the
    date it stops working on.

    Personal invitations cover the linking of accounts made from here on; this
    covers the ones that already exist, and the times a link was made against the
    wrong player. Passing a null player_id unlinks.

    A deadline is set on its own, so an account created from an invitation — a
    parent's, which the create endpoint cannot make — can still be given one, and
    when both are named the deadline wins. Passing a null expires_at lifts it.
    """
    user = await session.get(User, user_id)
    if user is None:
        raise api_error(404, "user_not_found", "Account not found.")
    if "expires_at" in payload.model_fields_set:
        await set_account_expiry(session, user, validate_expiry(payload.expires_at))
        await session.commit()
        await session.refresh(user)
        return user
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
async def list_invites(_: AdminUser, session: SessionDep) -> list[InviteRead]:
    invites = list(
        (
            await session.scalars(
                select(RegistrationInvite).order_by(RegistrationInvite.created_at.desc())
            )
        ).all()
    )
    return [await invite_read(session, invite) for invite in invites]


@router.post(
    "/registration-invites", response_model=GeneratedInviteRead, status_code=status.HTTP_201_CREATED
)
async def create_invite(
    payload: InviteCreate, admin: AdminUser, session: SessionDep
) -> GeneratedInviteRead:
    # The players named on the invitation, deduplicated with order kept, from
    # either the single-player field or the list a parent invitation uses.
    requested = list(
        dict.fromkeys(payload.player_ids + ([payload.player_id] if payload.player_id else []))
    )
    if payload.kind == InviteKind.parent and not requested:
        raise api_error(
            422,
            "validation_error",
            "Choose at least one child from the roster.Choose at least one child from the roster.",
        )
    if payload.kind == InviteKind.player and len(requested) > 1:
        raise api_error(422, "validation_error", "A player invitation is for one player.")
    if payload.kind == InviteKind.coach and not payload.team_id:
        raise api_error(422, "validation_error", "Choose one squad for the coach.")
    team = await session.get(Team, payload.team_id) if payload.team_id else None
    if payload.team_id and (team is None or not team.is_aimz or not team.is_active):
        raise api_error(422, "team_not_found", "Choose an active AIMZ squad.")

    # A player may only ever hold one account of their own, so a player
    # invitation is refused up front when that roster record is taken. A parent
    # does not claim the record, so several parents of one child are fine.
    player_ids: list[str] = []
    for player_id in requested:
        if payload.kind == InviteKind.player:
            claimed = await claimable_player(session, player_id)
            assert claimed is not None
            player_ids.append(claimed)
        else:
            player_ids.append(await roster_player(session, player_id))

    if payload.code:
        code = payload.code.strip().upper()
        code_hash = secret_hash("".join(c for c in code if c.isalnum()))
        if await session.scalar(
            select(RegistrationInvite.id).where(
                RegistrationInvite.code_hash.in_(invite_hash_candidates(payload.code))
            )
        ):
            raise api_error(409, "invite_exists", "That invitation code already exists.")
    else:
        code, code_hash = await unique_invite_code(session)
    invite = RegistrationInvite(
        label=payload.label,
        code_hash=code_hash,
        kind=payload.kind,
        player_id=player_ids[0] if payload.kind == InviteKind.player else None,
        team_id=payload.team_id
        or ((await session.get(Player, player_ids[0])).team_id if player_ids else None),
        application_id=payload.application_id,
        expires_at=payload.expires_at,
        # A player invitation is for that one person, whatever the caller asks
        # for: a second claim would find the roster record taken.
        max_uses=1 if payload.kind in {InviteKind.player, InviteKind.coach} else payload.max_uses,
        created_by_id=admin.id,
    )
    invite.players = [InvitePlayer(player_id=player_id) for player_id in player_ids]
    session.add(invite)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise api_error(409, "invite_exists", "That invitation code already exists.") from exc
    await session.refresh(invite)
    readable = await invite_read(session, invite)
    compact = "".join(character for character in code if character.isalnum())
    return GeneratedInviteRead(
        **readable.model_dump(),
        code=code,
        share_url=f"{settings.public_web_origin}/join/{compact}",
    )


@router.delete("/registration-invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(invite_id: str, _: AdminUser, session: SessionDep) -> Response:
    invite = await session.get(RegistrationInvite, invite_id)
    if invite is None:
        raise api_error(404, "invite_not_found", "Invitation not found.")
    invite.is_active = False
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
