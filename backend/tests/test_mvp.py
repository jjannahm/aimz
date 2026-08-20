from datetime import UTC, datetime, timedelta
from itertools import count

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_invite_auth_refresh_and_player_authorization(client: AsyncClient) -> None:
    registered = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "AIMZ Player",
            "email": "player@aimz.example.com",
            "password": "long-secure-password",
            "invite_code": "AIMZ-TEST",
        },
    )
    assert registered.status_code == 201, registered.text
    body = registered.json()
    assert body["user"]["role"] == "player"

    player_headers = {"Authorization": f"Bearer {body['access_token']}"}
    forbidden = await client.post(
        "/api/v1/teams",
        headers=player_headers,
        json={"name": "Not allowed"},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"]["code"] == "admin_required"

    refreshed = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}
    )
    assert refreshed.status_code == 200
    reused = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}
    )
    assert reused.status_code == 401


@pytest.mark.asyncio
async def test_password_reset_and_account_deletion(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, str] = {}

    async def capture_email(email: str, code: str) -> None:
        captured[email] = code

    monkeypatch.setattr("app.api.v1.routes.auth.send_password_reset", capture_email)
    registered = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Reset Player",
            "email": "reset@aimz.example.com",
            "password": "original-password",
            "invite_code": "AIMZ-TEST",
        },
    )
    assert registered.status_code == 201
    requested = await client.post(
        "/api/v1/auth/password-reset/request", json={"email": "reset@aimz.example.com"}
    )
    assert requested.status_code == 202
    confirmed = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={
            "email": "reset@aimz.example.com",
            "code": captured["reset@aimz.example.com"],
            "new_password": "replacement-password",
        },
    )
    assert confirmed.status_code == 200
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "reset@aimz.example.com", "password": "replacement-password"},
    )
    assert login.status_code == 200
    deleted = await client.delete(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert deleted.status_code == 204
    assert (
        await client.post(
            "/api/v1/auth/login",
            json={"email": "reset@aimz.example.com", "password": "replacement-password"},
        )
    ).status_code == 401


@pytest.mark.asyncio
async def test_full_match_scoring_standings_and_stats(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    home = await client.post(
        "/api/v1/teams",
        headers=admin_headers,
        json={
            "name": "AIMZ Navy",
            "squad_code": "RTS S14",
            "age_group": "U14",
            "season": "2026/27",
            "is_aimz": True,
        },
    )
    away = await client.post("/api/v1/teams", headers=admin_headers, json={"name": "Cairo Stars"})
    assert home.status_code == away.status_code == 201
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Academy League", "season": "2026/27", "type": "league"},
    )
    player = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={
            "name": "Nour Ali",
            "team_id": home.json()["id"],
            "position": "Forward",
            "jersey_number": 9,
        },
    )
    kickoff = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    match_payload = {
        "competition_id": competition.json()["id"],
        "home_team_id": home.json()["id"],
        "away_team_id": away.json()["id"],
        "kickoff_datetime": kickoff,
        "venue": "AIMZ Training Ground",
        "status": "scheduled",
    }
    match = await client.post("/api/v1/matches", headers=admin_headers, json=match_payload)
    assert match.status_code == 201, match.text
    match_id = match.json()["id"]

    match_payload["status"] = "live"
    assert (
        await client.patch(f"/api/v1/matches/{match_id}", headers=admin_headers, json=match_payload)
    ).status_code == 200
    event_payload = {
        "type": "goal",
        "minute": 23,
        "team_id": home.json()["id"],
        "player_id": player.json()["id"],
        "client_operation_id": "test-operation-001",
    }
    goal = await client.post(
        f"/api/v1/matches/{match_id}/events", headers=admin_headers, json=event_payload
    )
    duplicate = await client.post(
        f"/api/v1/matches/{match_id}/events", headers=admin_headers, json=event_payload
    )
    assert goal.status_code == duplicate.status_code == 201
    assert goal.json()["id"] == duplicate.json()["id"]

    live = await client.get(f"/api/v1/matches/{match_id}/live", headers=admin_headers)
    assert live.status_code == 200
    assert live.json()["match"]["home_score"] == 1
    unchanged = await client.get(
        f"/api/v1/matches/{match_id}/live",
        headers={**admin_headers, "If-None-Match": live.headers["etag"]},
    )
    assert unchanged.status_code == 304

    stats = await client.put(
        f"/api/v1/matches/{match_id}/player-stats",
        headers=admin_headers,
        json=[{"player_id": player.json()["id"], "appeared": True, "minutes_played": 90}],
    )
    assert stats.status_code == 200, stats.text
    assert stats.json()[0]["goals"] == 1

    match_payload["status"] = "finished"
    await client.patch(f"/api/v1/matches/{match_id}", headers=admin_headers, json=match_payload)
    table = await client.get(
        f"/api/v1/competitions/{competition.json()['id']}/standings", headers=admin_headers
    )
    assert table.status_code == 200
    assert table.json()[0]["team"]["id"] == home.json()["id"]
    assert table.json()[0]["points"] == 3
    summary = await client.get(
        f"/api/v1/players/{player.json()['id']}/stats?season=2026%2F27",
        headers=admin_headers,
    )
    assert summary.status_code == 200
    assert summary.json()["goals"] == 1
    assert summary.json()["minutes_played"] == 90

    deleted = await client.delete(
        f"/api/v1/matches/{match_id}/events/{goal.json()['id']}", headers=admin_headers
    )
    assert deleted.status_code == 204
    corrected = await client.get(f"/api/v1/matches/{match_id}/live", headers=admin_headers)
    assert corrected.json()["match"]["home_score"] == 0


@pytest.mark.asyncio
async def test_media_presign_contract(
    client: AsyncClient, admin_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    team = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "AIMZ Sky", "is_aimz": True}
    )

    monkeypatch.setattr(
        "app.api.v1.routes.media.create_presigned_upload",
        lambda key, content_type: {
            "url": "https://storage.test/upload",
            "fields": {"key": key, "Content-Type": content_type},
        },
    )
    response = await client.post(
        "/api/v1/media/uploads/presign",
        headers=admin_headers,
        json={"entity": "team", "entity_id": team.json()["id"], "content_type": "image/jpeg"},
    )
    assert response.status_code == 200
    assert response.json()["object_key"].startswith(f"teams/{team.json()['id']}/")


@pytest.mark.asyncio
async def test_media_presign_can_be_disabled(
    client: AsyncClient, admin_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.v1.routes.media.settings.media_enabled", False)

    response = await client.post(
        "/api/v1/media/uploads/presign",
        headers=admin_headers,
        json={
            "entity": "team",
            "entity_id": "00000000-0000-0000-0000-000000000000",
            "content_type": "image/jpeg",
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "media_disabled"

@pytest.mark.asyncio
async def test_stat_leaders_rank_by_metric_and_age_group(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    squad = await client.post(
        "/api/v1/teams",
        headers=admin_headers,
        json={"name": "AIMZ U13", "age_group": "U13", "season": "2026/27", "is_aimz": True},
    )
    other = await client.post(
        "/api/v1/teams",
        headers=admin_headers,
        json={"name": "AIMZ U15", "age_group": "U15", "season": "2026/27", "is_aimz": True},
    )
    opponent = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "Giza Lions"}
    )
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Youth League", "season": "2026/27", "type": "league"},
    )
    scorer = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Mariam Adel", "team_id": squad.json()["id"], "position": "Forward"},
    )
    creator = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Hana Samir", "team_id": squad.json()["id"], "position": "Midfielder"},
    )
    outsider = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Layla Tarek", "team_id": other.json()["id"], "position": "Forward"},
    )

    def payload_for(team_id: str, status: str) -> dict[str, str]:
        return {
            "competition_id": competition.json()["id"],
            "home_team_id": team_id,
            "away_team_id": opponent.json()["id"],
            "kickoff_datetime": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
            "venue": "AIMZ Training Ground",
            "status": status,
        }

    operations = count()

    async def play(team_id: str, tallies: list[tuple[str, str, int]]) -> str:
        """Create a match and log `count` events of `type` for each player."""
        created = await client.post(
            "/api/v1/matches", headers=admin_headers, json=payload_for(team_id, "scheduled")
        )
        assert created.status_code == 201, created.text
        match_id = created.json()["id"]
        started = await client.patch(
            f"/api/v1/matches/{match_id}", headers=admin_headers, json=payload_for(team_id, "live")
        )
        assert started.status_code == 200, started.text
        for player_id, event_type, tally in tallies:
            for index in range(tally):
                event = await client.post(
                    f"/api/v1/matches/{match_id}/events",
                    headers=admin_headers,
                    json={
                        "type": event_type,
                        "minute": 10 + index,
                        "team_id": team_id,
                        "player_id": player_id,
                        "client_operation_id": f"leaders-op-{next(operations)}",
                    },
                )
                assert event.status_code == 201, event.text
        return match_id

    squad_match = await play(
        squad.json()["id"],
        [
            (scorer.json()["id"], "goal", 3),
            (scorer.json()["id"], "assist", 1),
            (creator.json()["id"], "goal", 1),
            (creator.json()["id"], "assist", 4),
        ],
    )
    other_match = await play(other.json()["id"], [(outsider.json()["id"], "goal", 5)])

    # Only finished matches count toward the leaderboards.
    assert (
        await client.get("/api/v1/stats/leaders?metric=goals", headers=admin_headers)
    ).json() == []
    for match_id, team_id in ((squad_match, squad.json()["id"]), (other_match, other.json()["id"])):
        finished = await client.patch(
            f"/api/v1/matches/{match_id}",
            headers=admin_headers,
            json=payload_for(team_id, "finished"),
        )
        assert finished.status_code == 200, finished.text

    scorers = await client.get("/api/v1/stats/leaders?metric=goals", headers=admin_headers)
    assert scorers.status_code == 200, scorers.text
    assert [(row["rank"], row["player"]["name"], row["goals"]) for row in scorers.json()] == [
        (1, "Layla Tarek", 5),
        (2, "Mariam Adel", 3),
        (3, "Hana Samir", 1),
    ]
    assert scorers.json()[0]["appearances"] == 1

    assisters = await client.get("/api/v1/stats/leaders?metric=assists", headers=admin_headers)
    assert [(row["player"]["name"], row["assists"]) for row in assisters.json()] == [
        ("Hana Samir", 4),
        ("Mariam Adel", 1),
    ]

    scoped = await client.get(
        "/api/v1/stats/leaders?metric=goals&age_group=U13", headers=admin_headers
    )
    assert [row["player"]["name"] for row in scoped.json()] == ["Mariam Adel", "Hana Samir"]
    assert scoped.json()[0]["team"]["age_group"] == "U13"

    season_scoped = await client.get(
        "/api/v1/stats/leaders?metric=goals&season=2030%2F31", headers=admin_headers
    )
    assert season_scoped.json() == []


@pytest.mark.asyncio
async def test_match_stores_period_structure(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    home = await client.post("/api/v1/teams", headers=admin_headers, json={"name": "AIMZ Timing"})
    away = await client.post("/api/v1/teams", headers=admin_headers, json={"name": "Nile Rovers"})
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Timing Cup", "season": "2026/27", "type": "league"},
    )
    base = {
        "competition_id": competition.json()["id"],
        "home_team_id": home.json()["id"],
        "away_team_id": away.json()["id"],
        "kickoff_datetime": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        "venue": "AIMZ Training Ground",
        "status": "scheduled",
    }

    # Standard football is the default when the client says nothing.
    default = await client.post("/api/v1/matches", headers=admin_headers, json=base)
    assert default.status_code == 201, default.text
    assert default.json()["half_length_minutes"] == 45
    assert default.json()["num_halves"] == 2
    assert default.json()["half_time_break_minutes"] == 15

    quarters = await client.post(
        "/api/v1/matches",
        headers=admin_headers,
        json={**base, "half_length_minutes": 20, "num_halves": 4, "half_time_break_minutes": 5},
    )
    assert quarters.status_code == 201, quarters.text
    assert quarters.json()["num_halves"] == 4

    # The structure survives a round trip and can be edited afterwards.
    fetched = await client.get(
        f"/api/v1/matches/{quarters.json()['id']}/live", headers=admin_headers
    )
    assert fetched.json()["match"]["half_length_minutes"] == 20
    edited = await client.patch(
        f"/api/v1/matches/{quarters.json()['id']}",
        headers=admin_headers,
        json={**base, "half_length_minutes": 30, "num_halves": 2, "half_time_break_minutes": 10},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["half_length_minutes"] == 30

    rejected = await client.post(
        "/api/v1/matches", headers=admin_headers, json={**base, "num_halves": 0}
    )
    assert rejected.status_code == 422

    # Extra time is opt-in and adds two further periods.
    assert default.json()["has_extra_time"] is False
    knockout = await client.post(
        "/api/v1/matches",
        headers=admin_headers,
        json={**base, "has_extra_time": True, "extra_time_half_length_minutes": 15},
    )
    assert knockout.status_code == 201, knockout.text
    assert knockout.json()["has_extra_time"] is True
    assert knockout.json()["extra_time_half_length_minutes"] == 15


@pytest.mark.asyncio
async def test_goal_can_be_flagged_as_a_penalty(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    home = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "AIMZ Spot Kicks"}
    )
    away = await client.post("/api/v1/teams", headers=admin_headers, json={"name": "Luxor United"})
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Penalty Cup", "season": "2026/27", "type": "league"},
    )
    striker = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Farida Sami", "team_id": home.json()["id"], "position": "Forward"},
    )
    payload = {
        "competition_id": competition.json()["id"],
        "home_team_id": home.json()["id"],
        "away_team_id": away.json()["id"],
        "kickoff_datetime": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        "venue": "AIMZ Training Ground",
        "status": "live",
    }
    match = await client.post("/api/v1/matches", headers=admin_headers, json=payload)
    match_id = match.json()["id"]

    spot_kick = await client.post(
        f"/api/v1/matches/{match_id}/events",
        headers=admin_headers,
        json={
            "type": "goal",
            "minute": 12,
            "team_id": home.json()["id"],
            "player_id": striker.json()["id"],
            "is_penalty": True,
            "client_operation_id": "penalty-op-1",
        },
    )
    assert spot_kick.status_code == 201, spot_kick.text
    assert spot_kick.json()["is_penalty"] is True

    open_play = await client.post(
        f"/api/v1/matches/{match_id}/events",
        headers=admin_headers,
        json={
            "type": "goal",
            "minute": 30,
            "team_id": home.json()["id"],
            "player_id": striker.json()["id"],
            "client_operation_id": "open-play-op-1",
        },
    )
    assert open_play.json()["is_penalty"] is False

    # A penalty still counts as a goal on the scoreline.
    live = await client.get(f"/api/v1/matches/{match_id}/live", headers=admin_headers)
    assert live.json()["match"]["home_score"] == 2
    flags = {event["minute"]: event["is_penalty"] for event in live.json()["events"]}
    assert flags == {12: True, 30: False}
