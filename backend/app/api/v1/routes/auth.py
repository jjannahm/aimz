import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, status
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError

from app.api.deps import SessionDep, SessionUser
from app.api.v1.routes.newcomers import application_values
from app.core.config import is_default_invite_code, is_placeholder_password, settings
from app.core.errors import api_error
from app.core.security import (
    decoy_password_hash,
    hash_password,
    new_reset_code,
    secret_hash,
    verify_password,
)
from app.db.models import (
    InviteKind,
    InvitePlayer,
    NewcomerApplication,
    NewcomerSource,
    OnboardingStatus,
    PasswordResetToken,
    Player,
    RefreshSession,
    RegistrationInvite,
    Team,
    TeamStaff,
    User,
    UserChild,
    UserRole,
)
from app.schemas import (
    InviteContext,
    InvitePlayerRead,
    InviteResolveRequest,
    LoginRequest,
    MessageResponse,
    PasswordChange,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
)
from app.services import rate_limit
from app.services.accounts import assert_not_expired
from app.services.auth import issue_session
from app.services.email import send_password_reset
from app.services.invitations import invite_hash_candidates

router = APIRouter()
logger = logging.getLogger(__name__)


async def active_invite(
    session: SessionDep, code: str, *, lock: bool = False
) -> RegistrationInvite:
    # The seed's example code is published in this repository and in the AWS
    # secret template. Wherever real families sign up it opens nothing, even if
    # an older seed already wrote it to the database.
    if settings.hosted and is_default_invite_code(code):
        raise api_error(422, "invalid_invite", "That academy invitation code is invalid.")
    now = datetime.now(UTC)
    query = select(RegistrationInvite).where(
        RegistrationInvite.code_hash.in_(invite_hash_candidates(code)),
        RegistrationInvite.is_active.is_(True),
        or_(RegistrationInvite.expires_at.is_(None), RegistrationInvite.expires_at > now),
        or_(
            RegistrationInvite.max_uses.is_(None),
            RegistrationInvite.use_count < RegistrationInvite.max_uses,
        ),
    )
    if lock:
        query = query.with_for_update()
    invite = await session.scalar(query)
    if invite is None:
        raise api_error(422, "invalid_invite", "That academy invitation code is invalid.")
    return invite


@router.post("/invitations/resolve", response_model=InviteContext)
async def resolve_invitation(
    payload: InviteResolveRequest, request: Request, session: SessionDep
) -> InviteContext:
    # An invitation code is a credential too, and this is the place to guess one.
    await rate_limit.spend_attempt(
        session, rate_limit.INVITE_BY_ADDRESS, rate_limit.client_address(request)
    )
    invite = await active_invite(session, payload.code)
    players = list(
        (
            await session.execute(
                select(InvitePlayer.player_id, Player.name)
                .join(Player, Player.id == InvitePlayer.player_id)
                .where(InvitePlayer.invite_id == invite.id)
            )
        ).all()
    )
    if not players and invite.player_id:
        player = await session.get(Player, invite.player_id)
        if player:
            players = [(player.id, player.name)]
    team = await session.get(Team, invite.team_id) if invite.team_id else None
    return InviteContext(
        kind=invite.kind,
        label=invite.label,
        team_id=invite.team_id,
        team_name=team.name if team else None,
        players=[InvitePlayerRead(id=pid, name=name) for pid, name in players],
        requires_application=invite.kind == InviteKind.player and invite.application_id is None,
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest, request: Request, session: SessionDep
) -> TokenResponse:
    await rate_limit.spend_attempt(
        session, rate_limit.REGISTER_BY_ADDRESS, rate_limit.client_address(request)
    )
    invite = await active_invite(session, payload.invite_code, lock=True)

    # Which roster players this invitation was cut for. A player invitation names
    # one and the account carries it on ``users.player_id``; a parent invitation
    # names their children, who hang off ``user_children`` instead. The list is
    # authoritative, falling back to the column older invitations used.
    invited_player_ids = list(
        (
            await session.scalars(
                select(InvitePlayer.player_id).where(InvitePlayer.invite_id == invite.id)
            )
        ).all()
    )
    if not invited_player_ids and invite.player_id is not None:
        invited_player_ids = [invite.player_id]
    is_parent = invite.kind == InviteKind.parent
    is_coach = invite.kind == InviteKind.coach
    if is_parent and not invited_player_ids:
        raise api_error(
            409,
            "invalid_invite",
            "This invitation is not linked to a player. Ask an AIMZ administrator for a new one.",
        )
    if is_coach and not invite.team_id:
        raise api_error(409, "invalid_invite", "This coach invitation has no squad.")
    if invite.kind == InviteKind.player and invite.application_id is None:
        if payload.application is None and settings.require_player_application:
            raise api_error(422, "application_required", "Complete the player application.")
        if payload.application and (
            payload.application.full_name.casefold() != payload.name.strip().casefold()
            or str(payload.application.email).lower() != str(payload.email).lower()
        ):
            raise api_error(
                422, "application_mismatch", "Account name and email must match the application."
            )

    user = User(
        name=payload.name.strip(),
        email=str(payload.email).lower(),
        hashed_password=hash_password(payload.password),
        role=UserRole.parent if is_parent else (UserRole.coach if is_coach else UserRole.player),
        # A personal invitation carries the roster player it was cut for, so the
        # account knows whose stats are its own the moment it is created. A
        # parent claims no roster record; their children hang off user_children.
        player_id=(
            invited_player_ids[0]
            if invite.kind == InviteKind.player and invited_player_ids
            else None
        ),
        onboarding_status=(
            OnboardingStatus.pending
            if invite.kind == InviteKind.player and payload.application is not None
            else OnboardingStatus.approved
        ),
    )
    linked_player_id = user.player_id
    session.add(user)
    invite.use_count += 1
    if is_parent:
        await session.flush()
        for player_id in invited_player_ids:
            session.add(UserChild(user_id=user.id, player_id=player_id))
    elif is_coach:
        await session.flush()
        session.add(TeamStaff(user_id=user.id, team_id=invite.team_id))
    if invite.kind == InviteKind.player and invite.application_id:
        application = await session.get(NewcomerApplication, invite.application_id)
        if application:
            application.user_id = user.id
            application.player_id = user.player_id
            application.invite_id = invite.id
            user.onboarding_status = OnboardingStatus.approved
    elif invite.kind == InviteKind.player and payload.application:
        application = NewcomerApplication(
            source=NewcomerSource.account_registration,
            user_id=user.id,
            player_id=user.player_id,
            invite_id=invite.id,
            suggested_team_id=invite.team_id,
            **application_values(payload.application),
        )
        session.add(application)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        # Two constraints can land here. Saying "email" for a player collision
        # would send someone to change an address that was never the problem.
        if linked_player_id is not None and await session.scalar(
            select(User.id).where(User.player_id == linked_player_id)
        ):
            raise api_error(
                409,
                "player_already_linked",
                "That player already has an account. "
                "Ask an AIMZ administrator for a new invitation.",
            ) from exc
        raise api_error(409, "email_in_use", "An account already uses that email.") from exc
    response = await issue_session(session, user)
    await session.commit()
    return response


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, session: SessionDep) -> TokenResponse:
    email = str(payload.email).lower()
    await rate_limit.spend_attempt(
        session, rate_limit.LOGIN_BY_ADDRESS, rate_limit.client_address(request)
    )
    await rate_limit.spend_attempt(session, rate_limit.LOGIN_BY_ACCOUNT, email)
    user = await session.scalar(select(User).where(User.email == email))
    usable = user is not None and user.is_active
    # A missing or disabled account is checked against a decoy hash, so it takes
    # as long to refuse as a wrong password and the timing reveals nothing.
    verified = verify_password(
        payload.password, user.hashed_password if usable else decoy_password_hash()
    )
    # A password printed in this repository's templates never opens a hosted
    # account, even one seeded with it before anybody changed the secret.
    published = settings.hosted and is_placeholder_password(payload.password)
    if not usable or not verified or published:
        raise api_error(401, "invalid_credentials", "Email or password is incorrect.")
    # After the password, so an expired account cannot be told apart from a wrong
    # one by anybody who does not already hold the password for it.
    assert_not_expired(user)
    response = await issue_session(session, user)
    await session.commit()
    return response


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, session: SessionDep) -> TokenResponse:
    now = datetime.now(UTC)
    # Locked until this transaction revokes it, so two requests racing one
    # stolen token cannot each be handed a fresh session.
    refresh_session = await session.scalar(
        select(RefreshSession)
        .where(
            RefreshSession.token_hash == secret_hash(payload.refresh_token),
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > now,
        )
        .with_for_update()
    )
    if refresh_session is None:
        raise api_error(401, "invalid_refresh_token", "Sign in again to continue.")
    # A select (not a get) so the account's deadline is joined in and the expiry
    # check below sees it.
    user = await session.scalar(select(User).where(User.id == refresh_session.user_id))
    if user is None or not user.is_active:
        raise api_error(401, "invalid_refresh_token", "Sign in again to continue.")
    # A refresh token lives for a month; an expiry that let it keep minting
    # access tokens would be no deadline at all.
    assert_not_expired(user)
    refresh_session.revoked_at = now
    response = await issue_session(session, user)
    await session.commit()
    return response


@router.post("/logout", response_model=MessageResponse)
async def logout(payload: RefreshRequest, session: SessionDep) -> MessageResponse:
    await session.execute(
        update(RefreshSession)
        .where(RefreshSession.token_hash == secret_hash(payload.refresh_token))
        .values(revoked_at=datetime.now(UTC))
    )
    await session.commit()
    return MessageResponse(message="Signed out.")


@router.post("/password-reset/request", response_model=MessageResponse, status_code=202)
async def request_password_reset(
    payload: PasswordResetRequest, request: Request, session: SessionDep
) -> MessageResponse:
    email = str(payload.email).lower()
    await rate_limit.spend_attempt(
        session, rate_limit.RESET_REQUEST_BY_ADDRESS, rate_limit.client_address(request)
    )
    # Counted by the address asked about, whether or not it has an account, so
    # the limit itself cannot be used to tell the two apart.
    await rate_limit.spend_attempt(session, rate_limit.RESET_REQUEST_BY_ACCOUNT, email)
    user = await session.scalar(select(User).where(User.email == email))
    if user and user.is_active:
        now = datetime.now(UTC)
        code = new_reset_code()
        # Only the newest code works. Every request used to add another live
        # code beside the old ones, and each extra code multiplied the chance
        # of guessing one.
        await session.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        session.add(
            PasswordResetToken(
                user_id=user.id,
                code_hash=secret_hash(code),
                expires_at=now + timedelta(minutes=settings.password_reset_minutes),
            )
        )
        await session.commit()
        if settings.environment == "development" and not settings.smtp_host:
            logger.info("Development reset code for %s: %s", user.email, code)
        try:
            await send_password_reset(user.email, code)
        except Exception as exc:
            logger.exception("Password reset email delivery failed")
            if settings.environment == "production":
                raise api_error(503, "email_unavailable", "Reset email could not be sent.") from exc
    return MessageResponse(message="If the account exists, a reset code has been sent.")


@router.post("/password-reset/confirm", response_model=MessageResponse)
async def confirm_password_reset(
    payload: PasswordResetConfirm, request: Request, session: SessionDep
) -> MessageResponse:
    email = str(payload.email).lower()
    # A six-digit code is a million guesses. Counted per address and per
    # account before the code is even looked at, so it stays a million.
    await rate_limit.spend_attempt(
        session, rate_limit.RESET_CONFIRM_BY_ADDRESS, rate_limit.client_address(request)
    )
    await rate_limit.spend_attempt(session, rate_limit.RESET_CONFIRM_BY_ACCOUNT, email)
    user = await session.scalar(select(User).where(User.email == email))
    token = None
    if user:
        token = await session.scalar(
            select(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.code_hash == secret_hash(payload.code),
                PasswordResetToken.consumed_at.is_(None),
                PasswordResetToken.expires_at > datetime.now(UTC),
            )
            .order_by(PasswordResetToken.created_at.desc())
        )
    if user is None or token is None:
        raise api_error(422, "invalid_reset_code", "The reset code is invalid or expired.")
    user.hashed_password = hash_password(payload.new_password)
    token.consumed_at = datetime.now(UTC)
    await session.execute(
        update(RefreshSession)
        .where(RefreshSession.user_id == user.id, RefreshSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    await session.commit()
    return MessageResponse(message="Password updated. Sign in with the new password.")


@router.post("/password/change", response_model=MessageResponse)
async def change_password(
    payload: PasswordChange, current_user: SessionUser, session: SessionDep
) -> MessageResponse:
    # A session picked up from an unlocked phone should not be enough to guess
    # the password behind it.
    await rate_limit.spend_attempt(session, rate_limit.PASSWORD_BY_ACCOUNT, current_user.id)
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise api_error(422, "incorrect_password", "Current password is incorrect.")
    now = datetime.now(UTC)
    current_user.hashed_password = hash_password(payload.new_password)
    # Changing a password is how somebody locks out whoever else has been using
    # it, so every other signed-in device has to sign in again — as it already
    # must after a reset, and as the Worker has always done.
    await session.execute(
        update(RefreshSession)
        .where(RefreshSession.user_id == current_user.id, RefreshSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    await session.commit()
    return MessageResponse(message="Password updated.")
