import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _team(client: AsyncClient, headers: dict[str, str], aimz: bool = True) -> str:
    response = await client.post(
        "/api/v1/teams", headers=headers, json={"name": "AIMZ U14", "is_aimz": aimz}
    )
    return response.json()["id"]


async def _player(client: AsyncClient, headers: dict[str, str], team_id: str) -> str:
    response = await client.post(
        "/api/v1/players",
        headers=headers,
        json={"name": "Omar Ali", "team_id": team_id, "position": "CM"},
    )
    return response.json()["id"]


async def test_create_series_shares_series_id(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    team_id = await _team(client, admin_headers)
    response = await client.post(
        "/api/v1/training-sessions",
        headers=admin_headers,
        json={
            "team_id": team_id,
            "venue": "Main pitch",
            "duration_minutes": 90,
            "occurrences": [
                "2026-09-10T17:00:00Z",
                "2026-09-17T17:00:00Z",
                "2026-09-10T17:00:00Z",  # duplicate, should be deduped
            ],
        },
    )
    assert response.status_code == 201, response.text
    sessions = response.json()
    assert len(sessions) == 2  # deduped to two
    assert sessions[0]["series_id"] == sessions[1]["series_id"]
    assert sessions[0]["series_id"] is not None
    assert sessions[0]["team"]["id"] == team_id


async def test_non_aimz_team_rejected(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    team_id = await _team(client, admin_headers, aimz=False)
    response = await client.post(
        "/api/v1/training-sessions",
        headers=admin_headers,
        json={
            "team_id": team_id,
            "venue": "Main pitch",
            "duration_minutes": 90,
            "occurrences": ["2026-09-10T17:00:00Z"],
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "team_not_found"


async def test_delete_series_scope(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    team_id = await _team(client, admin_headers)
    created = await client.post(
        "/api/v1/training-sessions",
        headers=admin_headers,
        json={
            "team_id": team_id,
            "venue": "Main pitch",
            "duration_minutes": 90,
            "occurrences": ["2026-09-10T17:00:00Z", "2026-09-17T17:00:00Z"],
        },
    )
    first_id = created.json()[0]["id"]
    deleted = await client.delete(
        f"/api/v1/training-sessions/{first_id}?scope=series", headers=admin_headers
    )
    assert deleted.status_code == 204
    listing = await client.get("/api/v1/training-sessions", headers=admin_headers)
    assert listing.json()["total"] == 0  # whole series gone


async def test_availability_upsert(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    team_id = await _team(client, admin_headers)
    player_id = await _player(client, admin_headers, team_id)
    created = await client.post(
        "/api/v1/training-sessions",
        headers=admin_headers,
        json={
            "team_id": team_id,
            "venue": "Main pitch",
            "duration_minutes": 90,
            "occurrences": ["2026-09-10T17:00:00Z"],
        },
    )
    session_id = created.json()[0]["id"]

    put = await client.put(
        f"/api/v1/training-sessions/{session_id}/availability",
        headers=admin_headers,
        json={"player_id": player_id, "status": "going", "note": "On time"},
    )
    assert put.status_code == 200, put.text
    assert put.json()["status"] == "going"
    assert put.json()["player"]["id"] == player_id

    # Second answer for the same player updates in place, not a duplicate.
    again = await client.put(
        f"/api/v1/training-sessions/{session_id}/availability",
        headers=admin_headers,
        json={"player_id": player_id, "status": "not_going"},
    )
    assert again.status_code == 200
    listing = await client.get(
        f"/api/v1/training-sessions/{session_id}/availability", headers=admin_headers
    )
    assert len(listing.json()) == 1
    assert listing.json()[0]["status"] == "not_going"


async def test_player_off_squad_rejected(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    team_id = await _team(client, admin_headers)
    other_team = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "AIMZ U15", "is_aimz": True}
    )
    outsider = await _player(client, admin_headers, other_team.json()["id"])
    created = await client.post(
        "/api/v1/training-sessions",
        headers=admin_headers,
        json={
            "team_id": team_id,
            "venue": "Main pitch",
            "duration_minutes": 90,
            "occurrences": ["2026-09-10T17:00:00Z"],
        },
    )
    session_id = created.json()[0]["id"]
    response = await client.put(
        f"/api/v1/training-sessions/{session_id}/availability",
        headers=admin_headers,
        json={"player_id": outsider, "status": "going"},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "player_not_found"
