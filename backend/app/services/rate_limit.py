"""A budget of attempts for one subject, counted in fixed windows.

The doors into an account are the only things on this API worth guessing at: a
password, a six-digit reset code, an invitation code, the current password on a
borrowed session. Each is held to a count per window. The count lives in the
database rather than in the process, because the API runs on several instances
behind a load balancer and a limit an attacker resets by landing on another one
is not a limit. The Worker applies the same rules (cloudflare-api/src/rate-limit.ts).
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import Request
from sqlalchemy import case, delete
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import api_error
from app.db.models import AuthRateLimit


@dataclass(frozen=True)
class RateRule:
    # Keeps budgets apart, so failing to sign in never spends a password reset.
    scope: str
    limit: int
    window_seconds: int


# Generous per address: a school's wifi puts a whole squad's families behind one.
LOGIN_BY_ADDRESS = RateRule("login:address", 30, 900)
# Tighter per account, whichever addresses the guesses arrive from.
LOGIN_BY_ACCOUNT = RateRule("login:account", 10, 900)
INVITE_BY_ADDRESS = RateRule("invite:address", 30, 900)
REGISTER_BY_ADDRESS = RateRule("register:address", 10, 3600)
PASSWORD_BY_ACCOUNT = RateRule("password:account", 10, 900)
# A reset email is somebody else's inbox being written to, so it is scarce.
RESET_REQUEST_BY_ADDRESS = RateRule("reset-request:address", 10, 3600)
RESET_REQUEST_BY_ACCOUNT = RateRule("reset-request:account", 3, 3600)
# Six digits is a million codes. Five guesses a window against a code that lives
# fifteen minutes, and only the newest code valid, keeps that out of reach.
RESET_CONFIRM_BY_ADDRESS = RateRule("reset-confirm:address", 20, 900)
RESET_CONFIRM_BY_ACCOUNT = RateRule("reset-confirm:account", 5, 900)

ALL_RULES = (
    LOGIN_BY_ADDRESS,
    LOGIN_BY_ACCOUNT,
    INVITE_BY_ADDRESS,
    REGISTER_BY_ADDRESS,
    PASSWORD_BY_ACCOUNT,
    RESET_REQUEST_BY_ADDRESS,
    RESET_REQUEST_BY_ACCOUNT,
    RESET_CONFIRM_BY_ADDRESS,
    RESET_CONFIRM_BY_ACCOUNT,
)


def client_address(request: Request) -> str | None:
    """The address the request came from, as the outermost trusted proxy saw it.

    Each proxy appends the address it received from to X-Forwarded-For, so with
    ``trusted_proxy_hops`` proxies in front the client is that many entries from
    the end. Anything further left was written by the client and is ignored —
    reading the first entry would let anybody choose their own address and step
    around every per-address limit.
    """
    hops = settings.trusted_proxy_hops
    if hops > 0:
        forwarded = [
            part.strip()
            for part in request.headers.get("x-forwarded-for", "").split(",")
            if part.strip()
        ]
        return forwarded[-hops] if len(forwarded) >= hops else None
    return request.client.host if request.client else None


def _key(rule: RateRule, subject: str) -> str:
    # Keyed with the signing secret, so the table holds no address or email that
    # anybody with read access could take back out of it.
    message = f"{rule.scope}:{subject.strip().lower()}".encode()
    return hmac.new(settings.jwt_secret.encode(), message, hashlib.sha256).hexdigest()


async def spend_attempt(session: AsyncSession, rule: RateRule, subject: str | None) -> None:
    """Spend one attempt, refusing with 429 once the window's budget is gone.

    One statement both counts and reads the count back, so two requests landing
    together cannot both see the last free attempt. It commits straight away:
    the attempt has to stay counted when the request it belongs to is refused,
    and a refusal rolls back everything else the session was holding.
    """
    if not subject:
        return
    now = datetime.now(UTC)
    window_opened = now - timedelta(seconds=rule.window_seconds)
    dialect = session.bind.dialect.name
    insert = postgres_insert if dialect == "postgresql" else sqlite_insert
    statement = insert(AuthRateLimit).values(
        key_hash=_key(rule, subject), window_started_at=now, attempts=1
    )
    expired = AuthRateLimit.window_started_at <= window_opened
    statement = statement.on_conflict_do_update(
        index_elements=[AuthRateLimit.key_hash],
        set_={
            "attempts": case((expired, 1), else_=AuthRateLimit.attempts + 1),
            "window_started_at": case(
                (expired, statement.excluded.window_started_at),
                else_=AuthRateLimit.window_started_at,
            ),
        },
    ).returning(AuthRateLimit.attempts, AuthRateLimit.window_started_at)
    row = (await session.execute(statement)).one()
    await session.commit()
    if row.attempts <= rule.limit:
        return
    started = row.window_started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=UTC)
    reopens = started + timedelta(seconds=rule.window_seconds)
    retry_after = max(1, int((reopens - now).total_seconds()))
    raise api_error(
        429,
        "rate_limited",
        "Too many attempts. Wait a few minutes and try again.",
        headers={"Retry-After": str(retry_after)},
    )


async def purge_expired(session: AsyncSession) -> int:
    """Counters whose window closed before the longest rule could still read them."""
    longest = max(rule.window_seconds for rule in ALL_RULES)
    cutoff = datetime.now(UTC) - timedelta(seconds=longest)
    result = await session.execute(
        delete(AuthRateLimit).where(AuthRateLimit.window_started_at < cutoff)
    )
    await session.commit()
    return result.rowcount or 0
