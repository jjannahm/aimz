import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from functools import lru_cache

import jwt
from pwdlib import PasswordHash

from app.core.config import settings

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


@lru_cache(maxsize=1)
def decoy_password_hash() -> str:
    """A hash nobody knows the password to, for signing in to a missing account.

    Verifying against it costs the same Argon2 work as a real account, so a
    missing or disabled email is refused in the time a wrong password would be,
    and response time cannot be used to find out who has an account.
    """
    return hash_password(secrets.token_urlsafe(32))


def create_access_token(user_id: str, role: str) -> tuple[str, int]:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_minutes)
    token = jwt.encode(
        {"sub": user_id, "role": role, "type": "access", "exp": expires_at},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    return token, settings.access_token_minutes * 60


def decode_access_token(token: str) -> dict[str, str]:
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != "access" or not payload.get("sub"):
        raise jwt.InvalidTokenError("Invalid access token")
    return payload


def new_secret(byte_count: int = 32) -> str:
    return secrets.token_urlsafe(byte_count)


def secret_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_reset_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"
