import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _team(client, headers, name, aimz=True) -> str:
    r = await client.post(
        "/api/v1/teams", headers=headers, json={"name": name, "is_aimz": aimz}
    )
    return r.json()["id"]


async def _player(client, headers, team_id, name="Kareem") -> str:
    r = await client.post(
        "/api/v1/players",
        headers=headers,
        json={"name": name, "team_id": team_id, "position": "ST"},
    )
    return r.json()["id"]


async def _training(client, headers, team_id) -> str:
    r = await client.post(
        "/api/v1/training-sessions",
        headers=headers,
        json={
            "team_id": team_id,
            "venue": "Pitch",
            "duration_minutes": 90,
            "occurrences": ["2026-09-10T17:00:00Z"],
        },
    )
    return r.json()[0]["id"]


async def _match(client, headers, home, away) -> str:
    comp = await client.post(
        "/api/v1/competitions",
        headers=headers,
        json={"name": "League A", "season": "2026", "type": "league"},
    )
    r = await client.post(
        "/api/v1/matches",
        headers=headers,
        json={
            "competition_id": comp.json()["id"],
            "home_team_id": home,
            "away_team_id": away,
            "kickoff_datetime": "2026-09-20T15:00:00Z",
            "venue": "Stadium",
            "status": "scheduled",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _linked_user(client, admin_headers, player_id, email) -> dict[str, str]:
    created = await client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={"name": "Parent", "email": email, "password": "player-pass-123", "role": "player"},
    )
    assert created.status_code == 201, created.text
    await client.patch(
        f"/api/v1/admin/users/{created.json()['id']}",
        headers=admin_headers,
        json={"player_id": player_id},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "player-pass-123"}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def test_training_assignment_crud(client: AsyncClient, admin_headers) -> None:
    team_id = await _team(client, admin_headers, "AIMZ U12")
    training_id = await _training(client, admin_headers, team_id)
    created = await client.post(
        f"/api/v1/training-sessions/{training_id}/assignments",
        headers=admin_headers,
        json={"title": "Bring the bibs"},
    )
    assert created.status_code == 201, created.text
    assignment_id = created.json()["id"]
    assert created.json()["assigned_player"] is None

    listing = await client.get(
        f"/api/v1/training-sessions/{training_id}/assignments", headers=admin_headers
    )
    assert len(listing.json()) == 1

    deleted = await client.delete(
        f"/api/v1/training-sessions/{training_id}/assignments/{assignment_id}",
        headers=admin_headers,
    )
    assert deleted.status_code == 204


async def test_match_assignment_eligibility(client: AsyncClient, admin_headers) -> None:
    home = await _team(client, admin_headers, "AIMZ U12", aimz=True)
    away = await _team(client, admin_headers, "Rivals", aimz=False)
    match_id = await _match(client, admin_headers, home, away)
    aimz_player = await _player(client, admin_headers, home, "Home Kid")
    rival_player = await _player(client, admin_headers, away, "Away Kid")

    ok = await client.post(
        f"/api/v1/matches/{match_id}/assignments",
        headers=admin_headers,
        json={"title": "Warm-up lead", "assigned_player_id": aimz_player},
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["assigned_player"]["id"] == aimz_player

    bad = await client.post(
        f"/api/v1/matches/{match_id}/assignments",
        headers=admin_headers,
        json={"title": "Nope", "assigned_player_id": rival_player},
    )
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "assignment_player_ineligible"


async def test_non_admin_claim_and_release(client: AsyncClient, admin_headers) -> None:
    team_id = await _team(client, admin_headers, "AIMZ U12")
    player_id = await _player(client, admin_headers, team_id, "Self Player")
    training_id = await _training(client, admin_headers, team_id)
    created = await client.post(
        f"/api/v1/training-sessions/{training_id}/assignments",
        headers=admin_headers,
        json={"title": "Corner flags"},
    )
    assignment_id = created.json()["id"]
    user_headers = await _linked_user(client, admin_headers, player_id, "self@example.com")

    claim = await client.patch(
        f"/api/v1/event-assignments/{assignment_id}",
        headers=user_headers,
        json={"assigned_player_id": player_id},
    )
    assert claim.status_code == 200, claim.text
    assert claim.json()["assigned_player_id"] == player_id

    # Signing up someone else is refused.
    other = await _player(client, admin_headers, team_id, "Other Player")
    self_only = await client.patch(
        f"/api/v1/event-assignments/{assignment_id}",
        headers=user_headers,
        json={"assigned_player_id": other},
    )
    assert self_only.status_code == 403
    assert self_only.json()["detail"]["code"] == "assignment_self_only"

    # Release my own claim.
    release = await client.patch(
        f"/api/v1/event-assignments/{assignment_id}",
        headers=user_headers,
        json={"assigned_player_id": None},
    )
    assert release.status_code == 200
    assert release.json()["assigned_player_id"] is None


async def test_claim_taken(client: AsyncClient, admin_headers) -> None:
    team_id = await _team(client, admin_headers, "AIMZ U12")
    holder = await _player(client, admin_headers, team_id, "Holder")
    other = await _player(client, admin_headers, team_id, "Latecomer")
    training_id = await _training(client, admin_headers, team_id)
    created = await client.post(
        f"/api/v1/training-sessions/{training_id}/assignments",
        headers=admin_headers,
        json={"title": "Water bottles", "assigned_player_id": holder},
    )
    assignment_id = created.json()["id"]

    other_headers = await _linked_user(client, admin_headers, other, "late@example.com")
    taken = await client.patch(
        f"/api/v1/event-assignments/{assignment_id}",
        headers=other_headers,
        json={"assigned_player_id": other},
    )
    assert taken.status_code == 409
    assert taken.json()["detail"]["code"] == "assignment_taken"
