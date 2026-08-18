from typing import Annotated

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import api_error
from app.core.security import decode_access_token
from app.db.models import User, UserRole
from app.db.session import get_db_session

SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    if credentials is None:
        raise api_error(401, "authentication_required", "Sign in to continue.")
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.InvalidTokenError as exc:
        raise api_error(401, "invalid_token", "Your session is invalid or expired.") from exc
    user = await session.scalar(
        select(User).where(User.id == payload["sub"], User.is_active.is_(True))
    )
    if user is None:
        raise api_error(401, "invalid_token", "Your account is unavailable.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_admin(current_user: CurrentUser) -> User:
    if current_user.role != UserRole.admin:
        raise api_error(403, "admin_required", "Administrator access is required.")
    return current_user


AdminUser = Annotated[User, Depends(get_admin)]
