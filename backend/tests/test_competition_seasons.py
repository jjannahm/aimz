"""The season lifecycle: completing, reopening, and rolling a competition over
to its next season.

Ported from the Worker's competition-seasons behaviour. A completed season keeps
every row it had and stops accepting anything new — new fixtures, live scoring,
and knockout draws are all refused until it is reopened.
"""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient


async def _competition(client: AsyncClient, headers: dict, **over) -> dict:
    body = {"name": "Season League", "season": "2026/27", "type": "league", **over}
    response = await client.post("/api/v1/competitions", headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def _match(client: AsyncClient, headers: dict, competition_id: str) -> dict:
    home = await client.post(
        "/api/v1/teams", headers=headers, json={"name": "AIMZ Home", "is_aimz": True}
    )
    away = await client.post("/api/v1/teams", headers=headers, json={"name": "Away Club"})
    match = await client.post(
        "/api/v1/matches",
        headers=headers,
        json={
            "competition_id": competition_id,
            "home_team_id": home.json()["id"],
            "away_team_id": away.json()["id"],
            "kickoff_datetime": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
            "venue": "AIMZ Ground",
            "status": "scheduled",
        },
    )
    assert match.status_code == 201, match.text
    return match.json()


@pytest.mark.asyncio
async def test_completing_a_season_locks_it_and_reopening_frees_it(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    competition = await _competition(client, admin_headers)
    match = await _match(client, admin_headers, competition["id"])

    completed = await client.post(
        f"/api/v1/competitions/{competition['id']}/complete", headers=admin_headers
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
    assert completed.json()["completed_at"] is not None

    # Completing again is idempotent, not an error.
    again = await client.post(
        f"/api/v1/competitions/{competition['id']}/complete", headers=admin_headers
    )
    assert again.status_code == 200
    assert again.json()["status"] == "completed"

    # A finished season takes nothing new: no fixtures, no live scoring.
    new_fixture = await client.post(
        "/api/v1/matches",
        headers=admin_headers,
        json={
            "competition_id": competition["id"],
            "home_team_id": match["home_team_id"],
            "away_team_id": match["away_team_id"],
            "kickoff_datetime": (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
            "venue": "AIMZ Ground",
            "status": "scheduled",
        },
    )
    assert new_fixture.status_code == 409
    assert new_fixture.json()["detail"]["code"] == "season_completed"

    kicked_off = await client.post(
        f"/api/v1/matches/{match['id']}/phase",
        headers=admin_headers,
        json={"action": "start_match"},
    )
    assert kicked_off.status_code == 409
    assert kicked_off.json()["detail"]["code"] == "season_completed"

    reopened = await client.post(
        f"/api/v1/competitions/{competition['id']}/reopen", headers=admin_headers
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "active"
    assert reopened.json()["completed_at"] is None

    # Back in play, the match can kick off again.
    restarted = await client.post(
        f"/api/v1/matches/{match['id']}/phase",
        headers=admin_headers,
        json={"action": "start_match"},
    )
    assert restarted.status_code == 200, restarted.text


@pytest.mark.asyncio
async def test_a_season_with_a_live_match_cannot_be_completed(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    competition = await _competition(client, admin_headers)
    match = await _match(client, admin_headers, competition["id"])
    started = await client.post(
        f"/api/v1/matches/{match['id']}/phase",
        headers=admin_headers,
        json={"action": "start_match"},
    )
    assert started.status_code == 200, started.text

    refused = await client.post(
        f"/api/v1/competitions/{competition['id']}/complete", headers=admin_headers
    )
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "match_in_progress"


@pytest.mark.asyncio
async def test_a_completed_knockout_refuses_a_draw(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    competition = await _competition(
        client, admin_headers, name="Cup", type="tournament", team_count=4, group_size=2
    )
    await client.post(
        f"/api/v1/competitions/{competition['id']}/complete", headers=admin_headers
    )
    advanced = await client.post(
        f"/api/v1/competitions/{competition['id']}/advance",
        headers=admin_headers,
        json={"round": 2},
    )
    assert advanced.status_code == 409
    assert advanced.json()["detail"]["code"] == "season_completed"


@pytest.mark.asyncio
async def test_rolling_over_to_the_next_season(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    competition = await _competition(client, admin_headers)
    # A club entered in the old season, to be carried across.
    await client.post(
        "/api/v1/teams",
        headers=admin_headers,
        json={"name": "Carried FC", "is_aimz": True, "competition_id": competition["id"]},
    )

    same = await client.post(
        f"/api/v1/competitions/{competition['id']}/next-season",
        headers=admin_headers,
        json={"season": competition["season"]},
    )
    assert same.status_code == 422
    assert same.json()["detail"]["code"] == "same_season"

    rolled = await client.post(
        f"/api/v1/competitions/{competition['id']}/next-season",
        headers=admin_headers,
        json={"season": "2027/28", "carry_teams": True},
    )
    assert rolled.status_code == 201, rolled.text
    nxt = rolled.json()
    assert nxt["id"] != competition["id"]
    assert nxt["name"] == competition["name"]
    assert nxt["season"] == "2027/28"
    assert nxt["status"] == "active"

    # The club list came across as new rows belonging to the new season.
    teams = await client.get("/api/v1/teams?season=2027/28", headers=admin_headers)
    assert teams.status_code == 200, teams.text
    carried = [team for team in teams.json()["items"] if team["name"] == "Carried FC"]
    assert len(carried) == 1
    assert carried[0]["competition_id"] == nxt["id"]
    assert carried[0]["season"] == "2027/28"
