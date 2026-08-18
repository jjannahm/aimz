from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token, new_secret, secret_hash
from app.db.models import RefreshSession, User
from app.schemas import TokenResponse, UserRead


async def issue_session(session: AsyncSession, user: User) -> TokenResponse:
    raw_refresh = new_secret(48)
    refresh = RefreshSession(
        user_id=user.id,
        token_hash=secret_hash(raw_refresh),
        expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
    )
    session.add(refresh)
    access_token, expires_in = create_access_token(user.id, user.role.value)
    await session.flush()
    return TokenResponse(
        access_token=access_token,
        refresh_token=raw_refresh,
        expires_in=expires_in,
        user=UserRead.model_validate(user),
    )
