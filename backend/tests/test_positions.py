import pytest
from httpx import AsyncClient

from app.services.positions import code_for_free_text

pytestmark = pytest.mark.asyncio


async def _team(client, headers) -> str:
    r = await client.post(
        "/api/v1/teams", headers=headers, json={"name": "AIMZ U12", "is_aimz": True}
    )
    return r.json()["id"]


async def test_valid_code_accepted(client: AsyncClient, admin_headers) -> None:
    team_id = await _team(client, admin_headers)
    r = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Keeper Kid", "team_id": team_id, "position": "GK"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["position"] == "GK"


async def test_free_text_position_rejected(client: AsyncClient, admin_headers) -> None:
    team_id = await _team(client, admin_headers)
    r = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Old Style", "team_id": team_id, "position": "Goalkeeper"},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "validation_error"
    assert any(e["field"] == "position" for e in r.json()["detail"]["field_errors"])


def test_code_for_free_text_mapping() -> None:
    # Codes pass through; prose and lines resolve to the most central code.
    assert code_for_free_text("GK") == "GK"
    assert code_for_free_text("Goalkeeper") == "GK"
    assert code_for_free_text("keeper") == "GK"
    assert code_for_free_text("Centre-forward") == "CF"
    assert code_for_free_text("Defender") == "CB"
    assert code_for_free_text("Left wing-back") == "LWB"
    assert code_for_free_text("defensive midfielder") == "CM"
    assert code_for_free_text("Striker") == "ST"
    assert code_for_free_text("") == "CM"
    assert code_for_free_text(None) == "CM"
