"""The doors into an account, the headers on the way out, and data at rest."""

from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.requests import Request

from app import cli
from app.core import field_crypto
from app.core.config import Settings, settings
from app.core.security import hash_password
from app.db.models import User, UserRole
from app.services import rate_limit
from app.services.ics import escape_text

pytestmark = pytest.mark.asyncio

ADMIN = {"email": "admin@aimz.example.com", "password": "correct-horse-battery"}
KEY = "cross-implementation-test-key-0123456789abcdef"
# Sealed by cloudflare-api/src/field-crypto.ts with KEY. The Worker's tests open
# a value this backend sealed, so a D1 export imports either way.
FROM_WORKER = (
    "enc:v1:c-CzmiCOfmYh5u-n2Ey9t_2S4-JYOdxZBZZQ3MwibxeYf7qZmfSdt_w3i9s5J8CPkA9Aacp7cmDAUNgl"
)


def _application(name: str, email: str) -> dict:
    return {
        "branch": "Maadi", "full_name": name, "mobile": "01000000", "email": email,
        "whatsapp_mobile": "01000000", "date_of_birth": "2014-05-02", "nationality": "Egyptian",
        "address": "Cairo", "previous_academy": "None", "school_university": "School",
        "father_name": "Hossam", "father_mobile": "01010000", "mother_name": "Mona",
        "mother_mobile": "01020000", "medical_concerns": "Asthma; uses an inhaler",
        "medications": "Salbutamol", "consent": True,
    }


async def test_one_account_takes_ten_sign_in_attempts(client: AsyncClient) -> None:
    for attempt in range(10):
        wrong = await client.post(
            "/api/v1/auth/login", json={**ADMIN, "password": f"guess-{attempt}"}
        )
        assert wrong.status_code == 401
    blocked = await client.post("/api/v1/auth/login", json=ADMIN)
    assert blocked.status_code == 429
    assert blocked.json()["detail"]["code"] == "rate_limited"
    assert int(blocked.headers["retry-after"]) > 0


async def test_one_address_takes_ten_registrations_an_hour(client: AsyncClient) -> None:
    for attempt in range(10):
        response = await client.post(
            "/api/v1/auth/register",
            json={"name": "Someone", "email": f"r{attempt}@aimz.example.com",
                  "password": "long-secure-password", "invite_code": f"GUESS-{attempt}"},
        )
        assert response.status_code == 422
    blocked = await client.post(
        "/api/v1/auth/register",
        json={"name": "Someone", "email": "r10@aimz.example.com",
              "password": "long-secure-password", "invite_code": "AIMZ-TEST"},
    )
    assert blocked.status_code == 429


async def _two_reset_codes(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> list[str]:
    codes: list[str] = []

    async def capture(_: str, code: str) -> None:
        codes.append(code)

    monkeypatch.setattr("app.api.v1.routes.auth.send_password_reset", capture)
    for _ in range(2):
        requested = await client.post(
            "/api/v1/auth/password-reset/request", json={"email": ADMIN["email"]}
        )
        assert requested.status_code == 202
    return codes


RESET = {"email": ADMIN["email"], "new_password": "replacement-password"}


async def test_only_the_newest_reset_code_works(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    first, newest = await _two_reset_codes(client, monkeypatch)
    confirm = "/api/v1/auth/password-reset/confirm"
    if first != newest:  # one in a million, the two draws coincide
        stale = await client.post(confirm, json={**RESET, "code": first})
        assert stale.status_code == 422
    fresh = await client.post(confirm, json={**RESET, "code": newest})
    assert fresh.status_code == 200, fresh.text


async def test_a_reset_code_cannot_be_guessed(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, newest = await _two_reset_codes(client, monkeypatch)
    wrong = "000000" if newest != "000000" else "111111"
    for _ in range(5):
        guess = await client.post(
            "/api/v1/auth/password-reset/confirm", json={**RESET, "code": wrong}
        )
        assert guess.status_code == 422
    # Five tries spent on this account in this window: even the right code waits.
    blocked = await client.post(
        "/api/v1/auth/password-reset/confirm", json={**RESET, "code": newest}
    )
    assert blocked.status_code == 429


async def test_reset_requests_for_one_address_are_scarce(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def ignore(_: str, __: str) -> None:
        return None

    monkeypatch.setattr("app.api.v1.routes.auth.send_password_reset", ignore)
    for _ in range(3):
        sent = await client.post(
            "/api/v1/auth/password-reset/request", json={"email": "nobody@aimz.example.com"}
        )
        assert sent.status_code == 202
    blocked = await client.post(
        "/api/v1/auth/password-reset/request", json={"email": "nobody@aimz.example.com"}
    )
    assert blocked.status_code == 429


async def test_changing_a_password_signs_out_every_other_device(client: AsyncClient) -> None:
    phone = (await client.post("/api/v1/auth/login", json=ADMIN)).json()
    laptop = (await client.post("/api/v1/auth/login", json=ADMIN)).json()
    changed = await client.post(
        "/api/v1/auth/password/change",
        headers={"Authorization": f"Bearer {laptop['access_token']}"},
        json={"current_password": ADMIN["password"], "new_password": "a-brand-new-password"},
    )
    assert changed.status_code == 200, changed.text
    stolen = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": phone["refresh_token"]}
    )
    assert stolen.status_code == 401


async def test_an_administrator_names_the_role_of_a_new_account(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    base = {"name": "New Person", "password": "long-secure-password"}
    for index, role in enumerate([None, "coach", "Admin", "superuser"]):
        body = {**base, "email": f"role{index}@aimz.example.com"}
        if role is not None:
            body["role"] = role
        response = await client.post("/api/v1/admin/users", headers=admin_headers, json=body)
        assert response.status_code == 422, (role, response.text)
    player = await client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={**base, "email": "player@aimz.example.com", "role": "player"},
    )
    assert player.status_code == 201
    assert player.json()["role"] == "player"


async def test_published_defaults_open_nothing_on_a_hosted_environment(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with session_factory() as session:
        session.add(
            User(name="Seeded", email="seeded@aimz.example.com",
                 hashed_password=hash_password("CHANGE-ME-AFTER-DEPLOY"), role=UserRole.admin)
        )
        await session.commit()
    monkeypatch.setattr(settings, "environment", "staging")

    placeholder = await client.post(
        "/api/v1/auth/login",
        json={"email": "seeded@aimz.example.com", "password": "CHANGE-ME-AFTER-DEPLOY"},
    )
    assert placeholder.status_code == 401
    for code in ["AIMZ-PLAY", "aimz play"]:
        resolved = await client.post("/api/v1/auth/invitations/resolve", json={"code": code})
        assert resolved.status_code == 422


async def test_every_response_carries_security_headers(client: AsyncClient) -> None:
    for response in [
        await client.get("/api/v1/health"),
        await client.get("/api/v1/matches"),
    ]:
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert "max-age=31536000" in response.headers["strict-transport-security"]
        assert response.headers["content-security-policy"].startswith("default-src 'none'")


async def test_a_body_past_the_ceiling_is_refused(client: AsyncClient) -> None:
    oversized = await client.post(
        "/api/v1/auth/login",
        content=b'{"email":"a@aimz.example.com","password":"' + b"x" * 1_100_000 + b'"}',
        headers={"Content-Type": "application/json"},
    )
    assert oversized.status_code == 413
    assert oversized.json()["detail"]["code"] == "payload_too_large"


def test_production_requires_an_encryption_key_and_drops_local_origins() -> None:
    hosted = {
        "environment": "production",
        "jwt_secret": "x" * 48,
        "admin_password": "a-real-production-password",
    }
    with pytest.raises(ValidationError, match="DATA_ENCRYPTION_KEY"):
        Settings(**hosted, data_encryption_key=None)
    configured = Settings(**hosted, data_encryption_key=KEY)
    assert all(origin.host not in {"localhost", "127.0.0.1"}
               for origin in configured.backend_cors_origins)


def test_the_client_address_is_read_behind_trusted_proxies_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def request(forwarded: str) -> Request:
        return Request({
            "type": "http", "client": ("10.0.0.5", 443), "method": "GET", "path": "/",
            "headers": [(b"x-forwarded-for", forwarded.encode())],
        })

    # Nothing trusted: the socket peer, whatever the header claims.
    assert rate_limit.client_address(request("6.6.6.6")) == "10.0.0.5"
    # CloudFront then the ALB: the client is two from the end, and anything the
    # client wrote further left is ignored.
    monkeypatch.setattr(settings, "trusted_proxy_hops", 2)
    assert rate_limit.client_address(request("6.6.6.6, 203.0.113.9, 130.176.0.1")) == "203.0.113.9"
    assert rate_limit.client_address(request("203.0.113.9")) is None


def test_the_backend_opens_what_the_worker_sealed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "data_encryption_key", KEY)
    column = "newcomer_applications.medical_concerns"
    assert field_crypto.open_field(column, FROM_WORKER) == "Asthma — يستخدم بخاخ"
    # Bound to its column and its key: anywhere else it stays sealed.
    assert field_crypto.open_field("newcomer_applications.medications", FROM_WORKER) == FROM_WORKER
    monkeypatch.setattr(settings, "data_encryption_key", "another-key-that-is-also-long-enough-0")
    assert field_crypto.open_field(column, FROM_WORKER) == FROM_WORKER
    # An already-sealed value passes through untouched, which is the import path.
    assert field_crypto.seal_field(column, FROM_WORKER) == FROM_WORKER


async def test_health_notes_are_sealed_at_rest_and_open_for_an_administrator(
    client: AsyncClient,
    admin_headers: dict[str, str],
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "data_encryption_key", KEY)
    email = "sealed@aimz.example.com"
    registered = await client.post(
        "/api/v1/auth/register",
        json={"name": "Salma Nour", "email": email, "password": "long-secure-password",
              "invite_code": "AIMZ-TEST", "application": _application("Salma Nour", email)},
    )
    assert registered.status_code == 201, registered.text

    async with session_factory() as session:
        row = (await session.execute(text(
            "SELECT id, medical_concerns, medications FROM newcomer_applications"
        ))).one()
    assert row.medical_concerns.startswith("enc:v1:")
    assert "Asthma" not in row.medical_concerns and "Salbutamol" not in row.medications

    read = await client.get(f"/api/v1/admin/newcomers/{row.id}", headers=admin_headers)
    assert read.status_code == 200, read.text
    assert read.json()["medical_concerns"] == "Asthma; uses an inhaler"
    assert read.json()["medications"] == "Salbutamol"


async def test_the_seal_command_seals_rows_written_before_the_key(
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with session_factory() as session:
        await session.execute(text(
            "INSERT INTO newcomer_applications (id, source, stage, branch, full_name, mobile, "
            "email, whatsapp_mobile, date_of_birth, nationality, address, previous_academy, "
            "school_university, father_name, father_mobile, mother_name, mother_mobile, "
            "medical_concerns, medications, consent_version, consented_at, created_at, "
            "updated_at) VALUES ('legacy', 'public_link', 'new', 'Maadi', 'Legacy', '0100', "
            "'l@aimz.example.com', '0100', '2014-05-02', 'Egyptian', 'Cairo', 'None', 'School', "
            "'Hossam', '0101', 'Mona', '0102', 'Peanut allergy', 'EpiPen', '2026-09', "
            "'2026-09-01', '2026-09-01', '2026-09-01')"
        ))
        await session.commit()
    monkeypatch.setattr(settings, "data_encryption_key", KEY)
    monkeypatch.setattr(cli, "AsyncSessionFactory", session_factory)
    monkeypatch.setattr(cli, "engine", SimpleNamespace(dispose=_nothing))

    assert await cli.seal_health_data() == 1
    async with session_factory() as session:
        stored = (await session.execute(text(
            "SELECT medical_concerns, medications, updated_at FROM newcomer_applications"
        ))).one()
    assert stored.medical_concerns.startswith("enc:v1:")
    assert stored.medications.startswith("enc:v1:")
    assert str(stored.updated_at).startswith("2026-09-01")
    assert field_crypto.open_field(
        "newcomer_applications.medications", stored.medications
    ) == "EpiPen"
    assert await cli.seal_health_data() == 0


async def test_the_seed_refuses_published_defaults_on_a_hosted_environment(
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(cli, "AsyncSessionFactory", session_factory)
    monkeypatch.setattr(cli, "engine", SimpleNamespace(dispose=_nothing))
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "admin_email", "admin@aimz.example.com")

    monkeypatch.setattr(settings, "admin_password", "CHANGE-ME-AFTER-DEPLOY")
    with pytest.raises(SystemExit):
        await cli.seed()

    # The conftest admin stands in for one seeded before the secret changed.
    async with session_factory() as session:
        admin = await session.scalar(text("SELECT id FROM users WHERE email = :email")
                                     .bindparams(email="admin@aimz.example.com"))
        await session.execute(
            text("UPDATE users SET hashed_password = :hash WHERE id = :id")
            .bindparams(hash=hash_password("CHANGE-ME-AFTER-DEPLOY"), id=admin)
        )
        await session.commit()
    monkeypatch.setattr(settings, "admin_password", "the-real-admin-password")
    monkeypatch.setattr(settings, "initial_invite_code", "AIMZ-PLAY")
    await cli.seed()
    output = capsys.readouterr().out
    assert "Replaced the seeded admin's placeholder password." in output
    assert "Skipped the initial invitation" in output

    async with session_factory() as session:
        invites = await session.scalar(text("SELECT count(*) FROM registration_invites"))
    assert invites == 1  # only the conftest's own invitation


def test_calendar_text_cannot_start_a_property_of_its_own() -> None:
    assert escape_text("AIMZ Ground\rSUMMARY:Injected") == "AIMZ Ground\\nSUMMARY:Injected"
    assert escape_text("line\r\nbreak\nhere") == "line\\nbreak\\nhere"
    assert escape_text("bell\x07; comma, slash\\") == "bell\\; comma\\, slash\\\\"


async def _nothing() -> None:
    return None
