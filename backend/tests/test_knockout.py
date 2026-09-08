import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _competition(client, headers, team_count=8, group_size=4):
    body = {"name": "Cup", "season": "2026", "type": "tournament"}
    if team_count is not None:
        body["team_count"] = team_count
    if group_size is not None:
        body["group_size"] = group_size
    return await client.post("/api/v1/competitions", headers=headers, json=body)


async def _team(client, headers, name):
    r = await client.post(
        "/api/v1/teams", headers=headers, json={"name": name, "is_aimz": True}
    )
    return r.json()["id"]


async def test_bad_shape_rejected(client: AsyncClient, admin_headers) -> None:
    # 12 teams in fours = 3 groups, which does not halve into a bracket.
    bad = await _competition(client, admin_headers, team_count=12, group_size=4)
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "validation_error"
    assert bad.json()["detail"]["field_errors"][0]["field"] == "team_count"


async def test_creation_generates_groups_and_bracket(
    client: AsyncClient, admin_headers
) -> None:
    comp = await _competition(client, admin_headers, team_count=8, group_size=4)
    assert comp.status_code == 201, comp.text
    competition_id = comp.json()["id"]

    groups = await client.get(
        f"/api/v1/competitions/{competition_id}/groups", headers=admin_headers
    )
    # 8 teams / 4 = 2 groups.
    assert [g["name"] for g in groups.json()] == ["Group A", "Group B"]

    bracket = await client.get(
        f"/api/v1/competitions/{competition_id}/bracket", headers=admin_headers
    )
    body = bracket.json()
    assert body["team_count"] == 8
    # 2 groups -> round of 4 (Semi Finals) then Final.
    assert [(r["round"], r["label"]) for r in body["rounds"]] == [
        (4, "Semi Finals"),
        (2, "Final"),
    ]


async def test_group_seeding_and_bracket_advance(
    client: AsyncClient, admin_headers
) -> None:
    comp = await _competition(client, admin_headers, team_count=8, group_size=4)
    competition_id = comp.json()["id"]
    groups = (
        await client.get(
            f"/api/v1/competitions/{competition_id}/groups", headers=admin_headers
        )
    ).json()
    group_a, group_b = groups[0]["id"], groups[1]["id"]

    teams = {name: await _team(client, admin_headers, f"Team {name}") for name in "ABCDEFGH"}
    await client.put(
        f"/api/v1/competitions/{competition_id}/groups/{group_a}/teams",
        headers=admin_headers,
        json=[{"team_id": teams[n]} for n in "ABCD"],
    )
    await client.put(
        f"/api/v1/competitions/{competition_id}/groups/{group_b}/teams",
        headers=admin_headers,
        json=[{"team_id": teams[n]} for n in "EFGH"],
    )

    # A group only holds group_size teams.
    over = await client.put(
        f"/api/v1/competitions/{competition_id}/groups/{group_a}/teams",
        headers=admin_headers,
        json=[{"team_id": teams[n]} for n in "ABCDE"],
    )
    assert over.status_code == 422

    # Re-seed group A (the over-capacity call cleared it) and confirm membership.
    seeded = await client.put(
        f"/api/v1/competitions/{competition_id}/groups/{group_a}/teams",
        headers=admin_headers,
        json=[{"team_id": teams[n]} for n in "ABCD"],
    )
    assert {t["name"] for t in seeded.json()["teams"]} == {
        "Team A",
        "Team B",
        "Team C",
        "Team D",
    }

    # Advancing the semis before any group results is refused.
    early = await client.post(
        f"/api/v1/competitions/{competition_id}/advance",
        headers=admin_headers,
        json={"round": 4},
    )
    assert early.status_code == 409
    assert early.json()["detail"]["code"] == "groups_incomplete"


async def test_advance_rejects_unknown_round(
    client: AsyncClient, admin_headers
) -> None:
    comp = await _competition(client, admin_headers, team_count=8, group_size=4)
    competition_id = comp.json()["id"]
    response = await client.post(
        f"/api/v1/competitions/{competition_id}/advance",
        headers=admin_headers,
        json={"round": 7},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["field_errors"][0]["field"] == "round"


async def test_plain_league_has_no_knockout(
    client: AsyncClient, admin_headers
) -> None:
    comp = await _competition(client, admin_headers, team_count=None, group_size=None)
    competition_id = comp.json()["id"]
    groups = await client.get(
        f"/api/v1/competitions/{competition_id}/groups", headers=admin_headers
    )
    assert groups.json() == []
    advance = await client.post(
        f"/api/v1/competitions/{competition_id}/advance",
        headers=admin_headers,
        json={"round": 2},
    )
    assert advance.status_code == 409
    assert advance.json()["detail"]["code"] == "not_a_knockout"
