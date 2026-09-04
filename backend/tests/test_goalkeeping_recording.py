"""Goalkeeper stats recorded through live scoring and surfaced on squad-stats.

The walk itself is unit-tested in test_goalkeeping.py; this drives a match end to
end to prove the recompute is wired into the phase and timeline changes, writes
the goalkeeper columns, and that squad-stats and the per-match player-stats read
them back.
"""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient


async def _scaffold(client: AsyncClient, headers: dict[str, str]) -> dict:
    home = await client.post(
        "/api/v1/teams", headers=headers, json={"name": "AIMZ Keepers", "is_aimz": True}
    )
    away = await client.post("/api/v1/teams", headers=headers, json={"name": "Visitors FC"})
    competition = await client.post(
        "/api/v1/competitions",
        headers=headers,
        json={"name": "Keeper Cup", "season": "2026/27", "type": "league"},
    )
    keeper = await client.post(
        "/api/v1/players",
        headers=headers,
        json={"name": "Keeper One", "team_id": home.json()["id"], "position": "GK"},
    )
    striker = await client.post(
        "/api/v1/players",
        headers=headers,
        json={"name": "Striker One", "team_id": home.json()["id"], "position": "ST"},
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
    for response in (home, away, competition, keeper, striker, match):
        assert response.status_code == 201, response.text
    ids = {
        "home": home.json()["id"],
        "away": away.json()["id"],
        "keeper": keeper.json()["id"],
        "striker": striker.json()["id"],
        "match": match.json()["id"],
    }
    lineup = await client.put(
        f"/api/v1/matches/{ids['match']}/lineup",
        headers=headers,
        json=[
            {"player_id": ids["keeper"], "team_id": ids["home"], "is_starter": True, "position": "GK"},
            {"player_id": ids["striker"], "team_id": ids["home"], "is_starter": True, "position": "ST"},
        ],
    )
    assert lineup.status_code == 200, lineup.text
    started = await client.post(
        f"/api/v1/matches/{ids['match']}/phase", headers=headers, json={"action": "start_match"}
    )
    assert started.status_code == 200, started.text
    return ids


async def _event(client: AsyncClient, headers: dict[str, str], match_id: str, op: str, **body):
    payload = {"client_operation_id": op, **body}
    response = await client.post(
        f"/api/v1/matches/{match_id}/events", headers=headers, json=payload
    )
    assert response.status_code == 201, response.text
    return response


@pytest.mark.asyncio
async def test_keeper_is_charged_with_goals_and_credited_a_save(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _scaffold(client, admin_headers)
    match_id = ids["match"]

    # Two conceded, one the keeper's own side scored (off their record), and a
    # penalty the keeper saved.
    await _event(client, admin_headers, match_id, "op-conceded-0001", type="goal", minute=10, team_id=ids["away"])
    await _event(client, admin_headers, match_id, "op-conceded-0002", type="goal", minute=40, team_id=ids["away"])
    await _event(
        client, admin_headers, match_id, "op-conceded-0003",
        type="goal", minute=25, team_id=ids["home"], player_id=ids["striker"],
    )
    await _event(
        client, admin_headers, match_id, "op-conceded-0004",
        type="penalty_missed", minute=55, team_id=ids["away"], penalty_outcome="saved",
    )

    finished = await client.post(
        f"/api/v1/matches/{match_id}/phase", headers=admin_headers, json={"action": "finish_match"}
    )
    assert finished.status_code == 200, finished.text

    squad = await client.get(
        f"/api/v1/teams/{ids['home']}/squad-stats", headers=admin_headers
    )
    assert squad.status_code == 200, squad.text
    keeper_row = next(row for row in squad.json() if row["player_id"] == ids["keeper"])
    assert keeper_row["goals_conceded"] == 2
    assert keeper_row["clean_sheets"] == 0
    assert keeper_row["appearances"] == 1

    stats = await client.get(f"/api/v1/matches/{match_id}/player-stats", headers=admin_headers)
    keeper_stat = next(row for row in stats.json() if row["player_id"] == ids["keeper"])
    assert keeper_stat["goals_conceded"] == 2
    assert keeper_stat["penalties_saved"] == 1
    assert keeper_stat["clean_sheet"] == 0
    # An outfielder is answerable for none of it.
    striker_stat = next(row for row in stats.json() if row["player_id"] == ids["striker"])
    assert striker_stat["goals_conceded"] == 0
    assert striker_stat["clean_sheet"] == 0


@pytest.mark.asyncio
async def test_a_shutout_settles_a_clean_sheet_on_finishing(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _scaffold(client, admin_headers)
    match_id = ids["match"]
    await _event(
        client, admin_headers, match_id, "cs-cleansheet-0001",
        type="goal", minute=30, team_id=ids["home"], player_id=ids["striker"],
    )

    # While the match is still running the clean sheet is not yet settled.
    running = await client.get(f"/api/v1/matches/{match_id}/player-stats", headers=admin_headers)
    keeper_running = next(row for row in running.json() if row["player_id"] == ids["keeper"])
    assert keeper_running["clean_sheet"] == 0
    assert keeper_running["goals_conceded"] == 0

    finished = await client.post(
        f"/api/v1/matches/{match_id}/phase", headers=admin_headers, json={"action": "finish_match"}
    )
    assert finished.status_code == 200, finished.text

    squad = await client.get(f"/api/v1/teams/{ids['home']}/squad-stats", headers=admin_headers)
    keeper_row = next(row for row in squad.json() if row["player_id"] == ids["keeper"])
    assert keeper_row["clean_sheets"] == 1
    assert keeper_row["goals_conceded"] == 0
