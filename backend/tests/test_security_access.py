"""Reads held to the caller's squad, as the Worker already holds them.

Every list and every resource named by id answers a player or parent only for
the squads their account speaks for. The roster is the names of children, so
nothing here may be readable across squads by anybody but an administrator.
"""

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _created(client: AsyncClient, headers: dict[str, str], path: str, body: dict) -> str:
    response = await client.post(path, headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _finish_with_goal(
    client: AsyncClient, headers: dict[str, str], match_id: str, team_id: str, player_id: str
) -> None:
    event = await client.post(
        f"/api/v1/matches/{match_id}/events",
        headers=headers,
        json={
            "type": "goal",
            "minute": 10,
            "team_id": team_id,
            "player_id": player_id,
            "client_operation_id": f"goal-{match_id}",
        },
    )
    assert event.status_code == 201, event.text
    stats = await client.put(
        f"/api/v1/matches/{match_id}/player-stats",
        headers=headers,
        json=[{"player_id": player_id, "appeared": True, "minutes_played": 90}],
    )
    assert stats.status_code == 200, stats.text
    finished = await client.post(
        f"/api/v1/matches/{match_id}/phase", headers=headers, json={"action": "finish_match"}
    )
    assert finished.status_code == 200, finished.text


async def _world(client: AsyncClient, admin: dict[str, str]) -> dict[str, str]:
    """Two squads in two leagues, a shared opponent, a finished goal for each."""
    league = await _created(
        client, admin, "/api/v1/competitions",
        {"name": "Cairo League", "season": "2026/27", "type": "league"},
    )
    other = await _created(
        client, admin, "/api/v1/competitions",
        {"name": "Delta League", "season": "2026/27", "type": "league"},
    )
    mine = await _created(
        client, admin, "/api/v1/teams",
        {"name": "AIMZ U13", "is_aimz": True, "competition_id": league},
    )
    theirs = await _created(
        client, admin, "/api/v1/teams",
        {"name": "AIMZ U15", "is_aimz": True, "competition_id": other},
    )
    rival = await _created(client, admin, "/api/v1/teams", {"name": "Cairo Comets"})
    my_player = await _created(
        client, admin, "/api/v1/players", {"name": "Aya Nabil", "team_id": mine, "position": "ST"}
    )
    their_player = await _created(
        client, admin, "/api/v1/players",
        {"name": "Amina Adel", "team_id": theirs, "position": "ST"},
    )
    fixture = {"kickoff_datetime": "2026-09-20T15:00:00Z", "venue": "Cairo", "status": "live"}
    my_match = await _created(
        client, admin, "/api/v1/matches",
        {**fixture, "competition_id": league, "home_team_id": mine, "away_team_id": rival},
    )
    their_match = await _created(
        client, admin, "/api/v1/matches",
        {**fixture, "competition_id": other, "home_team_id": theirs, "away_team_id": rival},
    )
    await _finish_with_goal(client, admin, my_match, mine, my_player)
    await _finish_with_goal(client, admin, their_match, theirs, their_player)

    account = await client.post(
        "/api/v1/admin/users",
        headers=admin,
        json={"name": "Aya", "email": "aya@aimz.example.com", "password": "player-pass-123",
              "role": "player"},
    )
    assert account.status_code == 201, account.text
    linked = await client.patch(
        f"/api/v1/admin/users/{account.json()['id']}", headers=admin, json={"player_id": my_player}
    )
    assert linked.status_code == 200, linked.text
    login = await client.post(
        "/api/v1/auth/login", json={"email": "aya@aimz.example.com", "password": "player-pass-123"}
    )
    return {
        "league": league, "other": other, "mine": mine, "theirs": theirs, "rival": rival,
        "my_player": my_player, "their_player": their_player,
        "my_match": my_match, "their_match": their_match,
        "token": login.json()["access_token"],
    }


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _ids(client: AsyncClient, headers: dict[str, str], path: str) -> set[str]:
    response = await client.get(path, headers=headers)
    assert response.status_code == 200, response.text
    return {item["id"] for item in response.json()["items"]}


async def test_lists_hold_a_player_to_their_own_squad(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    world = await _world(client, admin_headers)
    family = _auth(world["token"])

    assert await _ids(client, family, "/api/v1/players") == {world["my_player"]}
    assert await _ids(client, family, f"/api/v1/players?team_id={world['theirs']}") == set()
    assert await _ids(client, family, "/api/v1/matches") == {world["my_match"]}
    assert await _ids(client, family, "/api/v1/teams") == {world["mine"], world["rival"]}
    assert await _ids(client, family, "/api/v1/competitions") == {world["league"]}

    # An administrator is not held to anything.
    everyone = await _ids(client, admin_headers, "/api/v1/players")
    assert {world["my_player"], world["their_player"]} <= everyone


async def test_resources_outside_the_squad_are_not_found(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    world = await _world(client, admin_headers)
    family = _auth(world["token"])

    for path in [
        f"/api/v1/matches/{world['their_match']}",
        f"/api/v1/matches/{world['their_match']}/events",
        f"/api/v1/matches/{world['their_match']}/lineup",
        f"/api/v1/matches/{world['their_match']}/player-stats",
        f"/api/v1/matches/{world['their_match']}/live",
        f"/api/v1/players/{world['their_player']}/stats",
        f"/api/v1/players/{world['their_player']}/honours",
        f"/api/v1/competitions/{world['other']}/standings",
        f"/api/v1/competitions/{world['other']}/awards",
        f"/api/v1/competitions/{world['other']}/awards/goals",
        f"/api/v1/competitions/{world['other']}/groups",
        f"/api/v1/competitions/{world['other']}/bracket",
        f"/api/v1/teams/{world['theirs']}/squad-stats",
        f"/api/v1/teams/{world['theirs']}/head-to-head/{world['rival']}",
    ]:
        response = await client.get(path, headers=family)
        assert response.status_code == 404, f"{path}: {response.status_code} {response.text}"

    # The same routes answer normally for the squad the account speaks for.
    for path in [
        f"/api/v1/matches/{world['my_match']}/live",
        f"/api/v1/players/{world['my_player']}/stats",
        f"/api/v1/competitions/{world['league']}/standings",
        f"/api/v1/teams/{world['mine']}/squad-stats",
    ]:
        response = await client.get(path, headers=family)
        assert response.status_code == 200, f"{path}: {response.status_code} {response.text}"


async def test_head_to_head_counts_only_meetings_the_caller_can_see(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    world = await _world(client, admin_headers)
    family = _auth(world["token"])

    own = await client.get(
        f"/api/v1/teams/{world['mine']}/head-to-head/{world['rival']}", headers=family
    )
    assert own.json()["played"] == 1
    # From the opponent's side, their meeting with the other squad stays hidden.
    via_rival = await client.get(
        f"/api/v1/teams/{world['rival']}/head-to-head/{world['theirs']}", headers=family
    )
    assert via_rival.status_code == 200
    assert via_rival.json()["played"] == 0
    as_admin = await client.get(
        f"/api/v1/teams/{world['rival']}/head-to-head/{world['theirs']}", headers=admin_headers
    )
    assert as_admin.json()["played"] == 1


async def test_leaders_rank_only_the_callers_competitions(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    world = await _world(client, admin_headers)

    def ranked(response) -> set[str]:
        assert response.status_code == 200, response.text
        return {row["player"]["id"] for row in response.json()}

    seen = ranked(await client.get("/api/v1/stats/leaders", headers=_auth(world["token"])))
    assert seen == {world["my_player"]}
    everyone = ranked(await client.get("/api/v1/stats/leaders", headers=admin_headers))
    assert {world["my_player"], world["their_player"]} <= everyone


async def test_an_unlinked_account_sees_empty_lists(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    await _world(client, admin_headers)
    registered = await client.post(
        "/api/v1/auth/register",
        json={"name": "Not Linked", "email": "unlinked@aimz.example.com",
              "password": "long-secure-password", "invite_code": "AIMZ-TEST"},
    )
    assert registered.status_code == 201, registered.text
    stranger = _auth(registered.json()["access_token"])
    for path in ["/api/v1/players", "/api/v1/matches", "/api/v1/teams", "/api/v1/competitions"]:
        assert await _ids(client, stranger, path) == set(), path
    leaders = await client.get("/api/v1/stats/leaders", headers=stranger)
    assert leaders.json() == []
