"""Account expiry, ported from the Worker's auth/helpers.

An account carries an optional deadline in ``account_expiry``. The date is
checked wherever an account is picked up — not only at sign-in, because an
access token already in hand outlives the moment by its own lifetime and a
refresh token by a month, so a deadline enforced only at the door would not be a
deadline.
"""

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import api_error
from app.db.models import AccountExpiry, User


def assert_not_expired(user: User) -> User:
    """Refuse an account whose deadline has passed. Checked after the password,
    so an expired account cannot be told from a wrong one by anybody who does not
    already hold the password for it."""
    expires_at = user.expires_at
    # SQLite hands back a naive datetime where Postgres keeps the zone; treat a
    # zoneless value as UTC so the comparison holds on either.
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at is not None and expires_at <= datetime.now(UTC):
        raise api_error(
            401,
            "account_expired",
            "This account has expired. Ask an AIMZ administrator to renew it.",
        )
    return user


def validate_expiry(value: datetime | None) -> datetime | None:
    """A deadline named on a request, as an aware instant, or None for none.

    A date already gone is refused rather than stored: it would create an account
    that could never be signed into, a mistake worth reporting when it is made.
    """
    if value is None:
        return None
    when = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    if when <= datetime.now(UTC):
        raise api_error(
            422,
            "validation_error",
            "An expiry has to be in the future.",
            field_errors=[{"field": "expires_at", "message": "Choose a date still to come."}],
        )
    return when


async def set_account_expiry(
    session: AsyncSession, user: User, expires_at: datetime | None
) -> None:
    """Write a deadline beside an account, or take it away when given None."""
    existing = await session.get(AccountExpiry, user.id)
    if expires_at is None:
        if existing is not None:
            await session.delete(existing)
        user.__dict__["expiry"] = None
        return
    if existing is not None:
        existing.expires_at = expires_at
    else:
        existing = AccountExpiry(user_id=user.id, expires_at=expires_at)
        session.add(existing)
    # Keep the loaded relationship in step so the account serialises with its new
    # deadline without a reload.
    user.__dict__["expiry"] = existing
