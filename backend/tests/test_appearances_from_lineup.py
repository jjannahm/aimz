"""Taking the field is the appearance, whether or not the player did anything.

An appearance used to be recorded only as a side effect of scoring, being named
in an event, or hand-entered minutes, so a quiet starter counted nil. It is now
read from the team sheet when the match is played. A named substitute who never
comes on is not counted — being on the sheet is not the same as playing.
"""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient


async def _scaffold(client: AsyncClient, headers: dict) -> dict:
    home = await client.post(
        "/api/v1/teams", headers=headers, json={"name": "AIMZ Quiet", "is_aimz": True}
    )
    away = await client.post("/api/v1/teams", headers=headers, json={"name": "Away Side"})
    competition = await client.post(
        "/api/v1/competitions",
        headers=headers,
        json={"name": "Appearance League", "season": "2026/27", "type": "league"},
    )
    quiet = await client.post(
        "/api/v1/players",
        headers=headers,
        json={"name": "Quiet Starter", "team_id": home.json()["id"], "position": "CB"},
    )
    bench = await client.post(
        "/api/v1/players",
        headers=headers,
        json={"name": "Unused Sub", "team_id": home.json()["id"], "position": "ST"},
    )
    match = await client.post(
        "/api/v1/matches",
        headers=headers,
        json={
            "competition_id": competition.json()["id"],
            "home_team_id": home.json()["id"],
            "away_team_id": away.json()["id"],
            "kickoff_datetime": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
            "venue": "AIMZ Ground",
            "status": "scheduled",
        },
    )
    for response in (home, away, competition, quiet, bench, match):
        assert response.status_code == 201, response.text
    ids = {
        "home": home.json()["id"],
        "quiet": quiet.json()["id"],
        "bench": bench.json()["id"],
        "match": match.json()["id"],
    }
    lineup = await client.put(
        f"/api/v1/matches/{ids['match']}/lineup",
        headers=headers,
        json=[
            {"player_id": ids["quiet"], "team_id": ids["home"], "is_starter": True, "position": "CB"},
            {"player_id": ids["bench"], "team_id": ids["home"], "is_starter": False, "position": "ST"},
        ],
    )
    assert lineup.status_code == 200, lineup.text
    return ids


@pytest.mark.asyncio
async def test_a_quiet_starter_appears_and_an_unused_sub_does_not(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _scaffold(client, admin_headers)
    for action in ("start_match", "finish_match"):
        response = await client.post(
            f"/api/v1/matches/{ids['match']}/phase", headers=admin_headers, json={"action": action}
        )
        assert response.status_code == 200, response.text

    stats = await client.get(
        f"/api/v1/matches/{ids['match']}/player-stats", headers=admin_headers
    )
    by_player = {row["player_id"]: row for row in stats.json()}
    # The starter who did nothing notable still took the field, and is stamped
    # with the squad she turned out for.
    assert by_player[ids["quiet"]]["appeared"] is True
    assert by_player[ids["quiet"]]["team_id"] == ids["home"]
    # The substitute who never came on did not appear (a row at all is fine).
    assert ids["bench"] not in by_player or by_player[ids["bench"]]["appeared"] is False


@pytest.mark.asyncio
async def test_the_sheet_appearance_reaches_the_squad_stats_tally(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _scaffold(client, admin_headers)
    home = (await client.get(f"/api/v1/matches/{ids['match']}", headers=admin_headers)).json()[
        "home_team"
    ]["id"]
    for action in ("start_match", "finish_match"):
        await client.post(
            f"/api/v1/matches/{ids['match']}/phase", headers=admin_headers, json={"action": action}
        )
    squad = await client.get(f"/api/v1/teams/{home}/squad-stats", headers=admin_headers)
    by_player = {row["player_id"]: row for row in squad.json()}
    # The quiet starter's one appearance shows in the season tally, at nought
    # goals; the unused sub is still at nil appearances.
    assert by_player[ids["quiet"]]["appearances"] == 1
    assert by_player[ids["quiet"]]["goals"] == 0
    assert by_player[ids["bench"]]["appearances"] == 0
