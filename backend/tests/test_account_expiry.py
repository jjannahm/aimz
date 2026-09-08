"""Account expiry: a login that stops working on a date.

Ported from the Worker's account-expiry behaviour. The deadline is checked
wherever an account is picked up — sign-in, refresh, and every authenticated
request — because a token already in hand outlives the moment it was issued.
Nothing is deleted when the date passes; an administrator can lift it.
"""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import AccountExpiry


async def _make_account(
    client: AsyncClient, admin_headers: dict[str, str], email: str, expires_at: str | None = None
) -> dict:
    body: dict[str, object] = {
        "name": "Trial Coach",
        "email": email,
        "password": "long-secure-password",
        "role": "player",
    }
    if expires_at is not None:
        body["expires_at"] = expires_at
    return await client.post("/api/v1/admin/users", headers=admin_headers, json=body)


@pytest.mark.asyncio
async def test_admin_creates_account_with_a_future_deadline(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    when = (datetime.now(UTC) + timedelta(days=7)).isoformat()
    created = await _make_account(client, admin_headers, "trial@aimz.example.com", when)
    assert created.status_code == 201, created.text
    assert created.json()["expires_at"] is not None

    # A deadline still to come does not stop the account working yet.
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "trial@aimz.example.com", "password": "long-secure-password"},
    )
    assert login.status_code == 200, login.text
    assert login.json()["user"]["expires_at"] is not None


@pytest.mark.asyncio
async def test_a_deadline_already_gone_is_refused_at_creation(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    created = await _make_account(client, admin_headers, "late@aimz.example.com", past)
    assert created.status_code == 422
    assert created.json()["detail"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_expired_account_is_locked_out_and_can_be_renewed(
    client: AsyncClient,
    admin_headers: dict[str, str],
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    created = await _make_account(client, admin_headers, "expired@aimz.example.com")
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]

    # Tokens minted while the account still worked; the deadline lands after.
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "expired@aimz.example.com", "password": "long-secure-password"},
    )
    assert login.status_code == 200, login.text
    tokens = login.json()
    stale_headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    async with session_factory() as session:
        session.add(
            AccountExpiry(
                user_id=user_id,
                expires_at=datetime.now(UTC) - timedelta(minutes=1),
            )
        )
        await session.commit()

    # Every way of picking the account up now refuses it — not only sign-in.
    relogin = await client.post(
        "/api/v1/auth/login",
        json={"email": "expired@aimz.example.com", "password": "long-secure-password"},
    )
    assert relogin.status_code == 401
    assert relogin.json()["detail"]["code"] == "account_expired"

    refreshed = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert refreshed.status_code == 401
    assert refreshed.json()["detail"]["code"] == "account_expired"

    with_stale_token = await client.get("/api/v1/users/me", headers=stale_headers)
    assert with_stale_token.status_code == 401
    assert with_stale_token.json()["detail"]["code"] == "account_expired"

    # Lifting the deadline is a renewal, not a resurrection: the account is back.
    lifted = await client.patch(
        f"/api/v1/admin/users/{user_id}", headers=admin_headers, json={"expires_at": None}
    )
    assert lifted.status_code == 200, lifted.text
    assert lifted.json()["expires_at"] is None

    back = await client.post(
        "/api/v1/auth/login",
        json={"email": "expired@aimz.example.com", "password": "long-secure-password"},
    )
    assert back.status_code == 200, back.text


@pytest.mark.asyncio
async def test_deadline_can_be_set_on_an_existing_account(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    created = await _make_account(client, admin_headers, "later@aimz.example.com")
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]
    assert created.json()["expires_at"] is None

    when = (datetime.now(UTC) + timedelta(days=30)).isoformat()
    dated = await client.patch(
        f"/api/v1/admin/users/{user_id}", headers=admin_headers, json={"expires_at": when}
    )
    assert dated.status_code == 200, dated.text
    assert dated.json()["expires_at"] is not None

    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    rejected = await client.patch(
        f"/api/v1/admin/users/{user_id}", headers=admin_headers, json={"expires_at": past}
    )
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "validation_error"
