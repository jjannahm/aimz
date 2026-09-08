"""A statistic stays with the squad it was earned with, even after the player
moves on.

The squad is stamped on player_match_stats.team_id from the lineup at scoring
time, so a promotion to an older age group never carries an old match's record
along. Leaders and awards credit that squad, not whichever one the player is
registered with now.
"""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient


async def _finished_goal_for_squad_a(client: AsyncClient, headers: dict[str, str]) -> dict:
    squad_a = await client.post(
        "/api/v1/teams", headers=headers, json={"name": "AIMZ Under-11s", "is_aimz": True}
    )
    squad_b = await client.post(
        "/api/v1/teams", headers=headers, json={"name": "AIMZ Under-13s", "is_aimz": True}
    )
    away = await client.post("/api/v1/teams", headers=headers, json={"name": "Rivals FC"})
    competition = await client.post(
        "/api/v1/competitions",
        headers=headers,
        json={"name": "Attribution League", "season": "2026/27", "type": "league"},
    )
    player = await client.post(
        "/api/v1/players",
        headers=headers,
        json={"name": "Rising Star", "team_id": squad_a.json()["id"], "position": "ST"},
    )
    match = await client.post(
        "/api/v1/matches",
        headers=headers,
        json={
            "competition_id": competition.json()["id"],
            "home_team_id": squad_a.json()["id"],
            "away_team_id": away.json()["id"],
            "kickoff_datetime": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
            "venue": "AIMZ Ground",
            "status": "scheduled",
        },
    )
    for response in (squad_a, squad_b, away, competition, player, match):
        assert response.status_code == 201, response.text
    ids = {
        "a": squad_a.json()["id"],
        "b": squad_b.json()["id"],
        "competition": competition.json()["id"],
        "player": player.json()["id"],
        "match": match.json()["id"],
    }

    lineup = await client.put(
        f"/api/v1/matches/{ids['match']}/lineup",
        headers=headers,
        json=[
            {
                "player_id": ids["player"],
                "team_id": ids["a"],
                "is_starter": True,
                "position": "ST",
            }
        ],
    )
    assert lineup.status_code == 200, lineup.text
    started = await client.post(
        f"/api/v1/matches/{ids['match']}/phase", headers=headers, json={"action": "start_match"}
    )
    assert started.status_code == 200, started.text
    goal = await client.post(
        f"/api/v1/matches/{ids['match']}/events",
        headers=headers,
        json={
            "type": "goal",
            "minute": 20,
            "team_id": ids["a"],
            "player_id": ids["player"],
            "client_operation_id": "attribution-goal-1",
        },
    )
    assert goal.status_code == 201, goal.text
    finished = await client.post(
        f"/api/v1/matches/{ids['match']}/phase", headers=headers, json={"action": "finish_match"}
    )
    assert finished.status_code == 200, finished.text
    return ids


@pytest.mark.asyncio
async def test_goal_is_stamped_with_the_squad_it_was_scored_for(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _finished_goal_for_squad_a(client, admin_headers)
    stats = await client.get(
        f"/api/v1/matches/{ids['match']}/player-stats", headers=admin_headers
    )
    row = next(r for r in stats.json() if r["player_id"] == ids["player"])
    assert row["goals"] == 1
    assert row["team_id"] == ids["a"]


@pytest.mark.asyncio
async def test_leaders_and_awards_credit_the_earned_squad_after_a_move(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _finished_goal_for_squad_a(client, admin_headers)

    # The player is promoted to the older squad after the match.
    moved = await client.patch(
        f"/api/v1/players/{ids['player']}",
        headers=admin_headers,
        json={"name": "Rising Star", "team_id": ids["b"], "position": "ST"},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["team_id"] == ids["b"]

    # Leaders still credit the squad the goal was scored for, not the new one.
    leaders = await client.get(
        f"/api/v1/stats/leaders?metric=goals&competition_id={ids['competition']}",
        headers=admin_headers,
    )
    assert leaders.status_code == 200, leaders.text
    leader = next(row for row in leaders.json() if row["player"]["id"] == ids["player"])
    assert leader["goals"] == 1
    assert leader["team"]["id"] == ids["a"]

    # As does the season honours board...
    awards = await client.get(
        f"/api/v1/competitions/{ids['competition']}/awards", headers=admin_headers
    )
    top_scorer = next(a for a in awards.json()["player_awards"] if a["label"] == "Top scorer")
    assert top_scorer["player"]["id"] == ids["player"]
    assert top_scorer["team"]["id"] == ids["a"]

    # ...and the full ranking behind one award.
    detail = await client.get(
        f"/api/v1/competitions/{ids['competition']}/awards/goals", headers=admin_headers
    )
    entry = next(e for e in detail.json() if e["player"]["id"] == ids["player"])
    assert entry["team"]["id"] == ids["a"]
