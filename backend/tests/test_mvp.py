from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_invite_auth_refresh_and_player_authorization(client: AsyncClient) -> None:
    registered = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "AIMZ Player",
            "email": "player@aimz.example.com",
            "password": "long-secure-password",
            "invite_code": "AIMZ-TEST",
        },
    )
    assert registered.status_code == 201, registered.text
    body = registered.json()
    assert body["user"]["role"] == "player"

    player_headers = {"Authorization": f"Bearer {body['access_token']}"}
    forbidden = await client.post(
        "/api/v1/teams",
        headers=player_headers,
        json={"name": "Not allowed"},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"]["code"] == "admin_required"

    refreshed = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}
    )
    assert refreshed.status_code == 200
    reused = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}
    )
    assert reused.status_code == 401


@pytest.mark.asyncio
async def test_password_reset_and_account_deletion(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, str] = {}

    async def capture_email(email: str, code: str) -> None:
        captured[email] = code

    monkeypatch.setattr("app.api.v1.routes.auth.send_password_reset", capture_email)
    registered = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Reset Player",
            "email": "reset@aimz.example.com",
            "password": "original-password",
            "invite_code": "AIMZ-TEST",
        },
    )
    assert registered.status_code == 201
    requested = await client.post(
        "/api/v1/auth/password-reset/request", json={"email": "reset@aimz.example.com"}
    )
    assert requested.status_code == 202
    confirmed = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={
            "email": "reset@aimz.example.com",
            "code": captured["reset@aimz.example.com"],
            "new_password": "replacement-password",
        },
    )
    assert confirmed.status_code == 200
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "reset@aimz.example.com", "password": "replacement-password"},
    )
    assert login.status_code == 200
    deleted = await client.delete(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert deleted.status_code == 204
    assert (
        await client.post(
            "/api/v1/auth/login",
            json={"email": "reset@aimz.example.com", "password": "replacement-password"},
        )
    ).status_code == 401


@pytest.mark.asyncio
async def test_full_match_scoring_standings_and_stats(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    home = await client.post(
        "/api/v1/teams",
        headers=admin_headers,
        json={
            "name": "AIMZ Navy",
            "squad_code": "RTS S14",
            "age_group": "U14",
            "season": "2026/27",
            "is_aimz": True,
        },
    )
    away = await client.post("/api/v1/teams", headers=admin_headers, json={"name": "Cairo Stars"})
    assert home.status_code == away.status_code == 201
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Academy League", "season": "2026/27", "type": "league"},
    )
    player = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={
            "name": "Nour Ali",
            "team_id": home.json()["id"],
            "position": "Forward",
            "jersey_number": 9,
        },
    )
    kickoff = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    match_payload = {
        "competition_id": competition.json()["id"],
        "home_team_id": home.json()["id"],
        "away_team_id": away.json()["id"],
        "kickoff_datetime": kickoff,
        "venue": "AIMZ Training Ground",
        "status": "scheduled",
    }
    match = await client.post("/api/v1/matches", headers=admin_headers, json=match_payload)
    assert match.status_code == 201, match.text
    match_id = match.json()["id"]

    match_payload["status"] = "live"
    assert (
        await client.patch(f"/api/v1/matches/{match_id}", headers=admin_headers, json=match_payload)
    ).status_code == 200
    event_payload = {
        "type": "goal",
        "minute": 23,
        "team_id": home.json()["id"],
        "player_id": player.json()["id"],
        "client_operation_id": "test-operation-001",
    }
    goal = await client.post(
        f"/api/v1/matches/{match_id}/events", headers=admin_headers, json=event_payload
    )
    duplicate = await client.post(
        f"/api/v1/matches/{match_id}/events", headers=admin_headers, json=event_payload
    )
    assert goal.status_code == duplicate.status_code == 201
    assert goal.json()["id"] == duplicate.json()["id"]

    live = await client.get(f"/api/v1/matches/{match_id}/live", headers=admin_headers)
    assert live.status_code == 200
    assert live.json()["match"]["home_score"] == 1
    unchanged = await client.get(
        f"/api/v1/matches/{match_id}/live",
        headers={**admin_headers, "If-None-Match": live.headers["etag"]},
    )
    assert unchanged.status_code == 304

    stats = await client.put(
        f"/api/v1/matches/{match_id}/player-stats",
        headers=admin_headers,
        json=[{"player_id": player.json()["id"], "appeared": True, "minutes_played": 90}],
    )
    assert stats.status_code == 200
    assert stats.json()[0]["goals"] == 1

    match_payload["status"] = "finished"
    await client.patch(f"/api/v1/matches/{match_id}", headers=admin_headers, json=match_payload)
    table = await client.get(
        f"/api/v1/competitions/{competition.json()['id']}/standings", headers=admin_headers
    )
    assert table.status_code == 200
    assert table.json()[0]["team"]["id"] == home.json()["id"]
    assert table.json()[0]["points"] == 3
    summary = await client.get(
        f"/api/v1/players/{player.json()['id']}/stats?season=2026%2F27",
        headers=admin_headers,
    )
    assert summary.status_code == 200
    assert summary.json()["goals"] == 1
    assert summary.json()["minutes_played"] == 90

    deleted = await client.delete(
        f"/api/v1/matches/{match_id}/events/{goal.json()['id']}", headers=admin_headers
    )
    assert deleted.status_code == 204
    corrected = await client.get(f"/api/v1/matches/{match_id}/live", headers=admin_headers)
    assert corrected.json()["match"]["home_score"] == 0


@pytest.mark.asyncio
async def test_media_presign_contract(
    client: AsyncClient, admin_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    team = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "AIMZ Sky", "is_aimz": True}
    )

    monkeypatch.setattr(
        "app.api.v1.routes.media.create_presigned_upload",
        lambda key, content_type: {
            "url": "https://storage.test/upload",
            "fields": {"key": key, "Content-Type": content_type},
        },
    )
    response = await client.post(
        "/api/v1/media/uploads/presign",
        headers=admin_headers,
        json={"entity": "team", "entity_id": team.json()["id"], "content_type": "image/jpeg"},
    )
    assert response.status_code == 200
    assert response.json()["object_key"].startswith(f"teams/{team.json()['id']}/")


@pytest.mark.asyncio
async def test_media_presign_can_be_disabled(
    client: AsyncClient, admin_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.v1.routes.media.settings.media_enabled", False)

    response = await client.post(
        "/api/v1/media/uploads/presign",
        headers=admin_headers,
        json={
            "entity": "team",
            "entity_id": "00000000-0000-0000-0000-000000000000",
            "content_type": "image/jpeg",
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "media_disabled"
