import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _finished_match_with_scorer(client: AsyncClient, headers: dict[str, str]):
    comp = await client.post(
        "/api/v1/competitions",
        headers=headers,
        json={"name": "Youth League", "season": "2026", "type": "league"},
    )
    competition_id = comp.json()["id"]
    home = await client.post(
        "/api/v1/teams", headers=headers, json={"name": "AIMZ U16", "is_aimz": True}
    )
    away = await client.post(
        "/api/v1/teams", headers=headers, json={"name": "Rivals", "is_aimz": False}
    )
    home_id, away_id = home.json()["id"], away.json()["id"]
    forward = await client.post(
        "/api/v1/players",
        headers=headers,
        json={"name": "Ziad Top", "team_id": home_id, "position": "ST"},
    )
    forward_id = forward.json()["id"]
    match = await client.post(
        "/api/v1/matches",
        headers=headers,
        json={
            "competition_id": competition_id,
            "home_team_id": home_id,
            "away_team_id": away_id,
            "kickoff_datetime": "2026-09-20T15:00:00Z",
            "venue": "Stadium",
            "status": "live",
        },
    )
    match_id = match.json()["id"]
    # Goals are derived from the timeline, so log real goal events.
    for index in range(3):
        event = await client.post(
            f"/api/v1/matches/{match_id}/events",
            headers=headers,
            json={
                "type": "goal",
                "minute": 10 + index,
                "team_id": home_id,
                "player_id": forward_id,
                "client_operation_id": f"goal-op-{index}",
            },
        )
        assert event.status_code == 201, event.text
    stats = await client.put(
        f"/api/v1/matches/{match_id}/player-stats",
        headers=headers,
        json=[{"player_id": forward_id, "appeared": True, "minutes_played": 90}],
    )
    assert stats.status_code == 200, stats.text
    finished = await client.post(
        f"/api/v1/matches/{match_id}/phase",
        headers=headers,
        json={"action": "finish_match"},
    )
    assert finished.status_code == 200, finished.text
    return {
        "competition_id": competition_id,
        "team_id": home_id,
        "forward_id": forward_id,
    }


async def test_award_detail_ranks_top_scorer(client: AsyncClient, admin_headers) -> None:
    ctx = await _finished_match_with_scorer(client, admin_headers)
    response = await client.get(
        f"/api/v1/competitions/{ctx['competition_id']}/awards/goals",
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    ranking = response.json()
    assert ranking[0]["rank"] == 1
    assert ranking[0]["player"]["id"] == ctx["forward_id"]
    assert ranking[0]["value"] == 3
    assert ranking[0]["unit"] == "goals"


async def test_unknown_award_and_competition(client: AsyncClient, admin_headers) -> None:
    ctx = await _finished_match_with_scorer(client, admin_headers)
    unknown = await client.get(
        f"/api/v1/competitions/{ctx['competition_id']}/awards/nonsense",
        headers=admin_headers,
    )
    assert unknown.status_code == 404
    assert unknown.json()["detail"]["code"] == "award_not_found"

    missing_comp = await client.get(
        "/api/v1/competitions/nope/awards/goals", headers=admin_headers
    )
    assert missing_comp.status_code == 404
    assert missing_comp.json()["detail"]["code"] == "competition_not_found"


async def test_player_honours(client: AsyncClient, admin_headers) -> None:
    ctx = await _finished_match_with_scorer(client, admin_headers)
    response = await client.get(
        f"/api/v1/players/{ctx['forward_id']}/honours", headers=admin_headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["player"]["id"] == ctx["forward_id"]
    honour_metrics = {h["metric"] for h in body["honours"]}
    # Top scorer at least; every match is finished, so it is final.
    assert "goals" in honour_metrics
    top = next(h for h in body["honours"] if h["metric"] == "goals")
    assert top["label"] == "Top scorer"
    assert top["value"] == 3
    assert top["is_final"] is True


async def test_squad_stats_includes_everyone(client: AsyncClient, admin_headers) -> None:
    ctx = await _finished_match_with_scorer(client, admin_headers)
    # A second player who has not featured should still appear, at nought.
    await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Bench Warmer", "team_id": ctx["team_id"], "position": "CB"},
    )
    response = await client.get(
        f"/api/v1/teams/{ctx['team_id']}/squad-stats", headers=admin_headers
    )
    assert response.status_code == 200, response.text
    rows = {row["player_id"]: row for row in response.json()}
    assert len(rows) == 2
    scorer = rows[ctx["forward_id"]]
    assert scorer["goals"] == 3
    assert scorer["appearances"] == 1
    assert scorer["clean_sheets"] == 0  # GK stats not yet ported
