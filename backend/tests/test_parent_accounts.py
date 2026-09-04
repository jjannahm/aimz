"""Parent accounts: an invitation naming several children, redeemed into an
account that speaks for each, whose squad access fans out over them all.

Ported from the Worker's parent-account behaviour (team-access + auth). The
point of the group is that every "scoping resolves to one player" path now
resolves to the several a parent has, so a parent is exercised through the same
team-hub and children endpoints a player uses.
"""

import pytest
from httpx import AsyncClient


async def _make_team_and_player(
    client: AsyncClient, headers: dict[str, str], team_name: str, player_name: str
) -> tuple[str, str]:
    team = await client.post(
        "/api/v1/teams", headers=headers, json={"name": team_name, "is_aimz": True}
    )
    assert team.status_code == 201, team.text
    player = await client.post(
        "/api/v1/players",
        headers=headers,
        json={"name": player_name, "team_id": team.json()["id"], "position": "GK"},
    )
    assert player.status_code == 201, player.text
    return team.json()["id"], player.json()["id"]


@pytest.mark.asyncio
async def test_parent_invite_links_every_child_and_fans_out_over_squads(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    # Two children on two different squads, so the fan-out is visible.
    team_a, child_a = await _make_team_and_player(client, admin_headers, "Under-10s", "Child A")
    team_b, child_b = await _make_team_and_player(client, admin_headers, "Under-12s", "Child B")
    team_c, _ = await _make_team_and_player(client, admin_headers, "Under-14s", "Someone")

    invite = await client.post(
        "/api/v1/admin/registration-invites",
        headers=admin_headers,
        json={
            "label": "Two children",
            "code": "PARENT-TWO",
            "kind": "parent",
            "player_ids": [child_a, child_b],
            "max_uses": 5,
        },
    )
    assert invite.status_code == 201, invite.text
    assert invite.json()["kind"] == "parent"
    assert invite.json()["player_id"] is None
    # A parent invitation keeps its requested uses; it is not pinned to one.
    assert invite.json()["max_uses"] == 5
    assert {p["id"] for p in invite.json()["players"]} == {child_a, child_b}

    registered = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "A Parent",
            "email": "parent@aimz.example.com",
            "password": "long-secure-password",
            "invite_code": "PARENT-TWO",
        },
    )
    assert registered.status_code == 201, registered.text
    body = registered.json()
    assert body["user"]["role"] == "parent"
    # A parent claims no roster record of their own.
    assert body["user"]["player_id"] is None
    parent_headers = {"Authorization": f"Bearer {body['access_token']}"}

    children = await client.get("/api/v1/users/me/children", headers=parent_headers)
    assert children.status_code == 200, children.text
    items = children.json()["items"]
    assert {c["id"] for c in items} == {child_a, child_b}
    assert {c["team_name"] for c in items} == {"Under-10s", "Under-12s"}

    # The team hub opens for either child's squad and refuses an unrelated one.
    for team_id in (team_a, team_b):
        allowed = await client.get(
            f"/api/v1/training-sessions?team_id={team_id}", headers=parent_headers
        )
        assert allowed.status_code == 200, allowed.text
    denied = await client.get(
        f"/api/v1/training-sessions?team_id={team_c}", headers=parent_headers
    )
    assert denied.status_code == 403

    # The admin account list groups a parent's children rather than showing a
    # player link they do not have.
    accounts = await client.get("/api/v1/admin/users?limit=100", headers=admin_headers)
    account = next(item for item in accounts.json()["items"] if item["id"] == body["user"]["id"])
    assert account["player"] is None
    assert {c["id"] for c in account["children"]} == {child_a, child_b}


@pytest.mark.asyncio
async def test_two_parents_may_name_the_same_child(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    _, child = await _make_team_and_player(client, admin_headers, "Under-9s", "Shared Child")
    for suffix in ("one", "two"):
        invite = await client.post(
            "/api/v1/admin/registration-invites",
            headers=admin_headers,
            json={
                "label": f"Parent {suffix}",
                "code": f"PARENT-{suffix}",
                "kind": "parent",
                "player_id": child,
            },
        )
        assert invite.status_code == 201, invite.text
        registered = await client.post(
            "/api/v1/auth/register",
            json={
                "name": f"Parent {suffix}",
                "email": f"parent-{suffix}@aimz.example.com",
                "password": "long-secure-password",
                "invite_code": f"PARENT-{suffix}",
            },
        )
        assert registered.status_code == 201, registered.text
        headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
        children = await client.get("/api/v1/users/me/children", headers=headers)
        assert [c["id"] for c in children.json()["items"]] == [child]


@pytest.mark.asyncio
async def test_invite_kind_validation(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    _, child_a = await _make_team_and_player(client, admin_headers, "Squad Alpha", "Alpha")
    _, child_b = await _make_team_and_player(client, admin_headers, "Squad Beta", "Beta")

    empty = await client.post(
        "/api/v1/admin/registration-invites",
        headers=admin_headers,
        json={"label": "No one", "code": "PARENT-EMPTY", "kind": "parent"},
    )
    assert empty.status_code == 422
    assert empty.json()["detail"]["code"] == "validation_error"

    too_many = await client.post(
        "/api/v1/admin/registration-invites",
        headers=admin_headers,
        json={
            "label": "Two into one",
            "code": "PLAYER-TWO",
            "kind": "player",
            "player_ids": [child_a, child_b],
        },
    )
    assert too_many.status_code == 422
    assert too_many.json()["detail"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_player_children_endpoint_returns_the_single_player(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    _, player = await _make_team_and_player(client, admin_headers, "First XI", "Solo Player")
    invite = await client.post(
        "/api/v1/admin/registration-invites",
        headers=admin_headers,
        json={"label": "Solo", "code": "SOLO-LINK", "player_id": player},
    )
    assert invite.status_code == 201, invite.text
    assert invite.json()["kind"] == "player"
    assert invite.json()["max_uses"] == 1

    registered = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Solo Login",
            "email": "solo@aimz.example.com",
            "password": "long-secure-password",
            "invite_code": "SOLO-LINK",
        },
    )
    assert registered.status_code == 201, registered.text
    assert registered.json()["user"]["role"] == "player"
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    children = await client.get("/api/v1/users/me/children", headers=headers)
    assert [c["id"] for c in children.json()["items"]] == [player]

    # An administrator speaks for no roster player, so answers with an empty list.
    admin_children = await client.get("/api/v1/users/me/children", headers=admin_headers)
    assert admin_children.status_code == 200
    assert admin_children.json()["items"] == []
