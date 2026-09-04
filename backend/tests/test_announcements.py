import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _aimz_team(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post(
        "/api/v1/teams",
        headers=headers,
        json={"name": "AIMZ U12", "is_aimz": True},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def test_requires_authentication(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/announcements")).status_code == 401


async def test_create_academy_wide(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/api/v1/announcements",
        headers=admin_headers,
        json={"title": "Kit collection", "body": "Collect new kit on Friday."},
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["team_id"] is None
    assert payload["team"] is None
    assert payload["author_name"] == "Test Admin"
    assert payload["pinned"] is False


async def test_team_notice_requires_aimz_team(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    bad = await client.post(
        "/api/v1/announcements",
        headers=admin_headers,
        json={"title": "Hi", "body": "Body text", "team_id": "does-not-exist"},
    )
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "team_not_found"

    team_id = await _aimz_team(client, admin_headers)
    good = await client.post(
        "/api/v1/announcements",
        headers=admin_headers,
        json={"title": "Training", "body": "Training moved to 6pm.", "team_id": team_id},
    )
    assert good.status_code == 201, good.text
    assert good.json()["team"]["id"] == team_id


async def test_pinned_sorts_first_and_list_counts(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    await client.post(
        "/api/v1/announcements",
        headers=admin_headers,
        json={"title": "First", "body": "Body one."},
    )
    second = await client.post(
        "/api/v1/announcements",
        headers=admin_headers,
        json={"title": "Second", "body": "Body two.", "pinned": True},
    )
    listing = await client.get("/api/v1/announcements", headers=admin_headers)
    assert listing.status_code == 200
    data = listing.json()
    assert data["total"] == 2
    assert data["items"][0]["title"] == "Second"  # pinned floats to the top


async def test_patch_and_delete(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    created = await client.post(
        "/api/v1/announcements",
        headers=admin_headers,
        json={"title": "Draft", "body": "Original body."},
    )
    announcement_id = created.json()["id"]

    patched = await client.patch(
        f"/api/v1/announcements/{announcement_id}",
        headers=admin_headers,
        json={"pinned": True, "body": "Updated body."},
    )
    assert patched.status_code == 200
    assert patched.json()["pinned"] is True
    assert patched.json()["body"] == "Updated body."

    deleted = await client.delete(
        f"/api/v1/announcements/{announcement_id}", headers=admin_headers
    )
    assert deleted.status_code == 204
    missing = await client.delete(
        f"/api/v1/announcements/{announcement_id}", headers=admin_headers
    )
    assert missing.status_code == 404
