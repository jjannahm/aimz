import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, status
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.core.errors import api_error
from app.core.security import (
    hash_password,
    new_reset_code,
    secret_hash,
    verify_password,
)
from app.db.models import PasswordResetToken, RefreshSession, RegistrationInvite, User, UserRole
from app.schemas import (
    LoginRequest,
    MessageResponse,
    PasswordChange,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
)
from app.services.auth import issue_session
from app.services.email import send_password_reset

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, session: SessionDep) -> TokenResponse:
    now = datetime.now(UTC)
    invite = await session.scalar(
        select(RegistrationInvite)
        .where(
            RegistrationInvite.code_hash == secret_hash(payload.invite_code),
            RegistrationInvite.is_active.is_(True),
            or_(RegistrationInvite.expires_at.is_(None), RegistrationInvite.expires_at > now),
            or_(
                RegistrationInvite.max_uses.is_(None),
                RegistrationInvite.use_count < RegistrationInvite.max_uses,
            ),
        )
        .with_for_update()
    )
    if invite is None:
        raise api_error(422, "invalid_invite", "That academy invitation code is invalid.")
    user = User(
        name=payload.name.strip(),
        email=str(payload.email).lower(),
        hashed_password=hash_password(payload.password),
        role=UserRole.player,
    )
    session.add(user)
    invite.use_count += 1
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise api_error(409, "email_in_use", "An account already uses that email.") from exc
    response = await issue_session(session, user)
    await session.commit()
    return response


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, session: SessionDep) -> TokenResponse:
    user = await session.scalar(select(User).where(User.email == str(payload.email).lower()))
    if (
        user is None
        or not user.is_active
        or not verify_password(payload.password, user.hashed_password)
    ):
        raise api_error(401, "invalid_credentials", "Email or password is incorrect.")
    response = await issue_session(session, user)
    await session.commit()
    return response


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, session: SessionDep) -> TokenResponse:
    now = datetime.now(UTC)
    refresh_session = await session.scalar(
        select(RefreshSession).where(
            RefreshSession.token_hash == secret_hash(payload.refresh_token),
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > now,
        )
    )
    if refresh_session is None:
        raise api_error(401, "invalid_refresh_token", "Sign in again to continue.")
    user = await session.get(User, refresh_session.user_id)
    if user is None or not user.is_active:
        raise api_error(401, "invalid_refresh_token", "Sign in again to continue.")
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
    payload: PasswordResetRequest, session: SessionDep
) -> MessageResponse:
    user = await session.scalar(select(User).where(User.email == str(payload.email).lower()))
    if user and user.is_active:
        code = new_reset_code()
        session.add(
            PasswordResetToken(
                user_id=user.id,
                code_hash=secret_hash(code),
                expires_at=datetime.now(UTC) + timedelta(minutes=settings.password_reset_minutes),
            )
        )
        await session.commit()
        if settings.environment != "production" and not settings.smtp_host:
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
    payload: PasswordResetConfirm, session: SessionDep
) -> MessageResponse:
    user = await session.scalar(select(User).where(User.email == str(payload.email).lower()))
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
    payload: PasswordChange, current_user: CurrentUser, session: SessionDep
) -> MessageResponse:
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise api_error(422, "incorrect_password", "Current password is incorrect.")
    current_user.hashed_password = hash_password(payload.new_password)
    await session.commit()
    return MessageResponse(message="Password updated.")
