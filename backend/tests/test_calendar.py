import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _linked_user(client, admin_headers, email="parent@example.com") -> dict:
    team = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "AIMZ U12", "is_aimz": True}
    )
    team_id = team.json()["id"]
    player = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Youssef", "team_id": team_id, "position": "GK"},
    )
    player_id = player.json()["id"]
    created = await client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={"name": "Parent", "email": email, "password": "player-pass-123", "role": "player"},
    )
    await client.patch(
        f"/api/v1/admin/users/{created.json()['id']}",
        headers=admin_headers,
        json={"player_id": player_id},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "player-pass-123"}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    return {"headers": headers, "team_id": team_id, "player_id": player_id}


async def test_admin_has_no_feed(client: AsyncClient, admin_headers) -> None:
    response = await client.get("/api/v1/users/me/calendar", headers=admin_headers)
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "player_link_required"


async def test_feed_lifecycle(client: AsyncClient, admin_headers) -> None:
    ctx = await _linked_user(client, admin_headers)
    headers = ctx["headers"]

    # No feed until asked for.
    empty = await client.get("/api/v1/users/me/calendar", headers=headers)
    assert empty.json() == {"url": None, "subscribed_at": None}

    # Creating is idempotent: same URL the second time.
    first = await client.post("/api/v1/users/me/calendar", headers=headers)
    assert first.status_code == 201, first.text
    url = first.json()["url"]
    assert "/api/v1/calendar/" in url and url.endswith("/aimz.ics")
    again = await client.post("/api/v1/users/me/calendar", headers=headers)
    assert again.status_code == 200
    assert again.json()["url"] == url

    # Regenerate mints a different address.
    regen = await client.post("/api/v1/users/me/calendar/regenerate", headers=headers)
    assert regen.json()["url"] != url

    # The old address no longer resolves.
    token = url.rsplit("/calendar/", 1)[1].split("/")[0]
    gone = await client.get(f"/api/v1/calendar/{token}/aimz.ics")
    assert gone.status_code == 404


async def test_feed_renders_ics_and_marks_subscribed(
    client: AsyncClient, admin_headers
) -> None:
    ctx = await _linked_user(client, admin_headers, email="fam@example.com")
    headers, team_id = ctx["headers"], ctx["team_id"]
    # A training session that should appear in the feed.
    await client.post(
        "/api/v1/training-sessions",
        headers=admin_headers,
        json={
            "team_id": team_id,
            "venue": "Main pitch",
            "duration_minutes": 90,
            "occurrences": ["2026-10-01T17:00:00Z"],
        },
    )
    created = await client.post("/api/v1/users/me/calendar", headers=headers)
    token = created.json()["url"].rsplit("/calendar/", 1)[1].split("/")[0]

    feed = await client.get(f"/api/v1/calendar/{token}/aimz.ics")
    assert feed.status_code == 200
    assert feed.headers["content-type"].startswith("text/calendar")
    body = feed.text
    assert "BEGIN:VCALENDAR" in body
    assert "BEGIN:VEVENT" in body
    assert "AIMZ U12 training" in body
    assert body.endswith("END:VCALENDAR\r\n")

    # First fetch marks the subscription.
    after = await client.get("/api/v1/users/me/calendar", headers=headers)
    assert after.json()["subscribed_at"] is not None


async def test_unknown_token_is_404(client: AsyncClient) -> None:
    response = await client.get("/api/v1/calendar/not-a-real-token/aimz.ics")
    assert response.status_code == 404
