import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _player(client: AsyncClient, headers: dict[str, str]) -> str:
    team = await client.post(
        "/api/v1/teams", headers=headers, json={"name": "AIMZ U13", "is_aimz": True}
    )
    player = await client.post(
        "/api/v1/players",
        headers=headers,
        json={"name": "Sami Nour", "team_id": team.json()["id"], "position": "GK"},
    )
    assert player.status_code == 201, player.text
    return player.json()["id"]


async def test_get_empty_roster(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    player_id = await _player(client, admin_headers)
    response = await client.get(
        f"/api/v1/players/{player_id}/contacts", headers=admin_headers
    )
    assert response.status_code == 200
    body = response.json()
    assert body == {"player_id": player_id, "date_of_birth": None, "contacts": []}


async def test_put_replaces_contacts_and_sets_dob(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    player_id = await _player(client, admin_headers)
    put = await client.put(
        f"/api/v1/players/{player_id}/contacts",
        headers=admin_headers,
        json={
            "date_of_birth": "2013-04-05",
            "contacts": [
                {"name": "Mother", "relationship": "parent", "phone": "0100"},
                {"name": "Father", "email": "dad@example.com"},
            ],
        },
    )
    assert put.status_code == 200, put.text
    body = put.json()
    assert body["date_of_birth"] == "2013-04-05"
    # Ordered by name: "Father" before "Mother".
    assert [c["name"] for c in body["contacts"]] == ["Father", "Mother"]

    # A second PUT replaces the list wholesale.
    replaced = await client.put(
        f"/api/v1/players/{player_id}/contacts",
        headers=admin_headers,
        json={"date_of_birth": None, "contacts": [{"name": "Guardian"}]},
    )
    assert replaced.status_code == 200
    assert replaced.json()["date_of_birth"] is None
    assert [c["name"] for c in replaced.json()["contacts"]] == ["Guardian"]


async def test_bad_date_is_rejected(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    player_id = await _player(client, admin_headers)
    response = await client.put(
        f"/api/v1/players/{player_id}/contacts",
        headers=admin_headers,
        json={"date_of_birth": "2013-13-40", "contacts": []},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "validation_error"


async def test_missing_player(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    response = await client.get(
        "/api/v1/players/nope/contacts", headers=admin_headers
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "player_not_found"
