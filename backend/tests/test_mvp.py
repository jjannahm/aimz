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
    started_match = await client.patch(
        f"/api/v1/matches/{match_id}", headers=admin_headers, json=match_payload
    )
    assert started_match.status_code == 200
    assert started_match.json()["phase"] == "first_half"
    assert started_match.json()["phase_started_at"] is not None
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
async def test_operator_controlled_match_clock_phases(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    home = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "AIMZ Clock Test"}
    )
    away = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "Clock Opponent"}
    )
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Clock Cup", "season": "2026/27", "type": "tournament"},
    )
    payload = {
        "competition_id": competition.json()["id"],
        "home_team_id": home.json()["id"],
        "away_team_id": away.json()["id"],
        "kickoff_datetime": datetime.now(UTC).isoformat(),
        "venue": "AIMZ Arena",
        "status": "scheduled",
        "has_extra_time": True,
    }
    created = await client.post("/api/v1/matches", headers=admin_headers, json=payload)
    assert created.status_code == 201
    assert created.json()["phase"] == "not_started"
    assert created.json()["phase_started_at"] is None
    match_id = created.json()["id"]

    unauthorized = await client.post(
        f"/api/v1/matches/{match_id}/phase", json={"action": "start_match"}
    )
    assert unauthorized.status_code == 401

    revision = 0
    for action, expected_phase, running in [
        ("start_match", "first_half", True),
        ("halftime", "halftime", False),
        ("start_second_half", "second_half", True),
        ("start_extra_time", "extra_time", True),
        ("finish_match", "finished", False),
    ]:
        response = await client.post(
            f"/api/v1/matches/{match_id}/phase",
            headers=admin_headers,
            json={"action": action},
        )
        assert response.status_code == 200, response.text
        revision += 1
        assert response.json()["phase"] == expected_phase
        assert response.json()["revision"] == revision
        assert (response.json()["phase_started_at"] is not None) is running

    snapshot = await client.get(f"/api/v1/matches/{match_id}/live", headers=admin_headers)
    assert snapshot.json()["match"]["phase"] == "finished"


@pytest.mark.asyncio
async def test_match_clock_rejects_skipped_phases(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    home = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "AIMZ Phase Test"}
    )
    away = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "Phase Opponent"}
    )
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Phase Cup", "season": "2026/27", "type": "tournament"},
    )
    created = await client.post(
        "/api/v1/matches",
        headers=admin_headers,
        json={
            "competition_id": competition.json()["id"],
            "home_team_id": home.json()["id"],
            "away_team_id": away.json()["id"],
            "kickoff_datetime": datetime.now(UTC).isoformat(),
            "venue": "AIMZ Arena",
            "status": "scheduled",
        },
    )
    response = await client.post(
        f"/api/v1/matches/{created.json()['id']}/phase",
        headers=admin_headers,
        json={"action": "start_second_half"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_match_phase"

    for action in ("start_match", "halftime", "start_second_half"):
        response = await client.post(
            f"/api/v1/matches/{created.json()['id']}/phase",
            headers=admin_headers,
            json={"action": action},
        )
        assert response.status_code == 200
    response = await client.post(
        f"/api/v1/matches/{created.json()['id']}/phase",
        headers=admin_headers,
        json={"action": "start_extra_time"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_match_phase"


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

    async def play(team_id: str, tallies: list[tuple[str, str | None, int]]) -> str:
        """Create a match and log `count` goals for each scorer/assister pair."""
        created = await client.post(
            "/api/v1/matches", headers=admin_headers, json=payload_for(team_id, "scheduled")
        )
        assert created.status_code == 201, created.text
        match_id = created.json()["id"]
        started = await client.patch(
            f"/api/v1/matches/{match_id}", headers=admin_headers, json=payload_for(team_id, "live")
        )
        assert started.status_code == 200, started.text
        for player_id, assister_id, tally in tallies:
            for index in range(tally):
                event = await client.post(
                    f"/api/v1/matches/{match_id}/events",
                    headers=admin_headers,
                    json={
                        "type": "goal",
                        "minute": 10 + index,
                        "team_id": team_id,
                        "player_id": player_id,
                        "secondary_player_id": assister_id,
                        "client_operation_id": f"leaders-op-{next(operations)}",
                    },
                )
                assert event.status_code == 201, event.text
        return match_id

    squad_match = await play(
        squad.json()["id"],
        [
            # Three goals for the scorer, each laid on by the creator.
            (scorer.json()["id"], creator.json()["id"], 3),
            # One back the other way.
            (creator.json()["id"], scorer.json()["id"], 1),
        ],
    )
    other_match = await play(other.json()["id"], [(outsider.json()["id"], None, 5)])

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
        ("Hana Samir", 3),
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


@pytest.mark.asyncio
async def test_lineup_format_and_locking(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    squad = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "AIMZ Sevens", "is_aimz": True}
    )
    away = await client.post("/api/v1/teams", headers=admin_headers, json={"name": "Delta Girls"})
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Sevens League", "season": "2026/27", "type": "league"},
    )
    roster = []
    for index in range(3):
        created = await client.post(
            "/api/v1/players",
            headers=admin_headers,
            json={
                "name": f"Player {index}",
                "team_id": squad.json()["id"],
                "position": "Midfielder",
            },
        )
        roster.append(created.json()["id"])

    base = {
        "competition_id": competition.json()["id"],
        "home_team_id": squad.json()["id"],
        "away_team_id": away.json()["id"],
        "kickoff_datetime": (datetime.now(UTC) + timedelta(days=7)).isoformat(),
        "venue": "AIMZ Training Ground",
        "status": "scheduled",
    }
    match = await client.post("/api/v1/matches", headers=admin_headers, json=base)
    match_id = match.json()["id"]
    assert match.json()["lineup_format"] is None

    # Only the five recognised formats are accepted.
    rejected = await client.patch(
        f"/api/v1/matches/{match_id}", headers=admin_headers, json={**base, "lineup_format": 8}
    )
    assert rejected.status_code == 422

    accepted = await client.patch(
        f"/api/v1/matches/{match_id}", headers=admin_headers, json={**base, "lineup_format": 7}
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["lineup_format"] == 7

    # A lineup can be set well before kickoff, and edited afterwards.
    entries = [
        {"player_id": roster[0], "team_id": squad.json()["id"], "is_starter": True},
        {"player_id": roster[1], "team_id": squad.json()["id"], "is_starter": False},
    ]
    saved = await client.put(
        f"/api/v1/matches/{match_id}/lineup", headers=admin_headers, json=entries
    )
    assert saved.status_code == 200, saved.text
    assert sum(row["is_starter"] for row in saved.json()) == 1

    edited = await client.put(
        f"/api/v1/matches/{match_id}/lineup",
        headers=admin_headers,
        json=[{"player_id": roster[2], "team_id": squad.json()["id"], "is_starter": True}],
    )
    assert edited.status_code == 200, edited.text

    # Once the match starts the starting lineup is frozen.
    started = await client.patch(
        f"/api/v1/matches/{match_id}", headers=admin_headers, json={**base, "status": "live"}
    )
    assert started.status_code == 200, started.text
    locked = await client.put(
        f"/api/v1/matches/{match_id}/lineup", headers=admin_headers, json=entries
    )
    assert locked.status_code == 409
    assert locked.json()["detail"]["code"] == "lineup_locked"


@pytest.mark.asyncio
async def test_formation_must_fit_the_format_and_coaches_live_on_the_team(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    squad = await client.post(
        "/api/v1/teams",
        headers=admin_headers,
        json={
            "name": "AIMZ Shapes",
            "is_aimz": True,
            "coach": "Mona Farouk",
            "assistant_coach": "Dalia Nasr",
        },
    )
    assert squad.status_code == 201, squad.text
    assert squad.json()["coach"] == "Mona Farouk"
    assert squad.json()["assistant_coach"] == "Dalia Nasr"

    away = await client.post("/api/v1/teams", headers=admin_headers, json={"name": "Suez Swifts"})
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Shape League", "season": "2026/27", "type": "league"},
    )
    base = {
        "competition_id": competition.json()["id"],
        "home_team_id": squad.json()["id"],
        "away_team_id": away.json()["id"],
        "kickoff_datetime": (datetime.now(UTC) + timedelta(days=3)).isoformat(),
        "venue": "AIMZ Training Ground",
        "status": "scheduled",
    }

    # 3-2-1 covers six outfield players, which is exactly 7-a-side.
    seven = await client.post(
        "/api/v1/matches",
        headers=admin_headers,
        json={**base, "lineup_format": 7, "formation": "3-2-1"},
    )
    assert seven.status_code == 201, seven.text
    assert seven.json()["formation"] == "3-2-1"

    # The same shape cannot fill an 11-a-side pitch.
    mismatch = await client.post(
        "/api/v1/matches",
        headers=admin_headers,
        json={**base, "lineup_format": 11, "formation": "3-2-1"},
    )
    assert mismatch.status_code == 422

    nonsense = await client.post(
        "/api/v1/matches",
        headers=admin_headers,
        json={**base, "lineup_format": 7, "formation": "not-a-shape"},
    )
    assert nonsense.status_code == 422

    # A coach can be cleared without disturbing the rest of the squad.
    cleared = await client.patch(
        f"/api/v1/teams/{squad.json()['id']}",
        headers=admin_headers,
        json={"name": "AIMZ Shapes", "is_aimz": True, "coach": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["coach"] is None


@pytest.mark.asyncio
async def test_lineup_records_a_captain(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    squad = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "AIMZ Armband", "is_aimz": True}
    )
    away = await client.post("/api/v1/teams", headers=admin_headers, json={"name": "Tanta Town"})
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Armband Cup", "season": "2026/27", "type": "league"},
    )
    keeper = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Nour Hassan", "team_id": squad.json()["id"], "position": "Goalkeeper"},
    )
    skipper = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Salma Nabil", "team_id": squad.json()["id"], "position": "Defender"},
    )
    match = await client.post(
        "/api/v1/matches",
        headers=admin_headers,
        json={
            "competition_id": competition.json()["id"],
            "home_team_id": squad.json()["id"],
            "away_team_id": away.json()["id"],
            "kickoff_datetime": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
            "venue": "AIMZ Training Ground",
            "status": "scheduled",
        },
    )
    saved = await client.put(
        f"/api/v1/matches/{match.json()['id']}/lineup",
        headers=admin_headers,
        json=[
            {
                "player_id": keeper.json()["id"],
                "team_id": squad.json()["id"],
                "is_starter": True,
            },
            {
                "player_id": skipper.json()["id"],
                "team_id": squad.json()["id"],
                "is_starter": True,
                "is_captain": True,
            },
        ],
    )
    assert saved.status_code == 200, saved.text
    captains = [row["player_id"] for row in saved.json() if row["is_captain"]]
    assert captains == [skipper.json()["id"]]

    # The armband survives a round trip through the live snapshot.
    live = await client.get(f"/api/v1/matches/{match.json()['id']}/live", headers=admin_headers)
    assert [row["player_id"] for row in live.json()["lineup"] if row["is_captain"]] == captains


@pytest.mark.asyncio
async def test_team_entered_in_a_competition_appears_in_its_table(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Entry League", "season": "2026/27", "type": "league"},
    )
    competition_id = competition.json()["id"]

    # An empty league has no table at all.
    empty = await client.get(
        f"/api/v1/competitions/{competition_id}/standings", headers=admin_headers
    )
    assert empty.json() == []

    entered = await client.post(
        "/api/v1/teams",
        headers=admin_headers,
        json={"name": "Delta FC", "competition_id": competition_id},
    )
    assert entered.status_code == 201, entered.text
    assert entered.json()["competition_id"] == competition_id

    # It now shows on nil, without having played anything.
    table = await client.get(
        f"/api/v1/competitions/{competition_id}/standings", headers=admin_headers
    )
    assert [row["team"]["name"] for row in table.json()] == ["Delta FC"]
    row = table.json()[0]
    assert (row["played"], row["points"], row["goal_difference"]) == (0, 0, 0)

    # A team entered elsewhere stays out of this table.
    other = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Other League", "season": "2026/27", "type": "league"},
    )
    await client.post(
        "/api/v1/teams",
        headers=admin_headers,
        json={"name": "Faraway United", "competition_id": other.json()["id"]},
    )
    unchanged = await client.get(
        f"/api/v1/competitions/{competition_id}/standings", headers=admin_headers
    )
    assert [row["team"]["name"] for row in unchanged.json()] == ["Delta FC"]


@pytest.mark.asyncio
async def test_entered_team_appears_in_the_table_before_playing(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Entry League", "season": "2026/27", "type": "league"},
    )
    entered = await client.post(
        "/api/v1/teams",
        headers=admin_headers,
        json={"name": "Delta FC", "competition_id": competition.json()["id"]},
    )
    assert entered.status_code == 201, entered.text
    assert entered.json()["competition_id"] == competition.json()["id"]

    # No match has been played, yet the club is already in the table on nil.
    table = await client.get(
        f"/api/v1/competitions/{competition.json()['id']}/standings", headers=admin_headers
    )
    assert table.status_code == 200, table.text
    rows = {row["team"]["name"]: row for row in table.json()}
    assert "Delta FC" in rows
    assert rows["Delta FC"]["played"] == 0
    assert rows["Delta FC"]["points"] == 0

    # A club entered elsewhere stays out of this table.
    other = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Other League", "season": "2026/27", "type": "league"},
    )
    await client.post(
        "/api/v1/teams",
        headers=admin_headers,
        json={"name": "Faraway United", "competition_id": other.json()["id"]},
    )
    again = await client.get(
        f"/api/v1/competitions/{competition.json()['id']}/standings", headers=admin_headers
    )
    assert "Faraway United" not in {row["team"]["name"] for row in again.json()}


@pytest.mark.asyncio
async def test_goal_carries_its_assist_and_standalone_assists_are_refused(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    squad = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": "AIMZ Combined", "is_aimz": True}
    )
    away = await client.post("/api/v1/teams", headers=admin_headers, json={"name": "Minya Meteors"})
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": "Combined Cup", "season": "2026/27", "type": "league"},
    )
    scorer = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Farida Sami", "team_id": squad.json()["id"], "position": "Forward"},
    )
    provider = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Nada Wagdy", "team_id": squad.json()["id"], "position": "Midfielder"},
    )
    match = await client.post(
        "/api/v1/matches",
        headers=admin_headers,
        json={
            "competition_id": competition.json()["id"],
            "home_team_id": squad.json()["id"],
            "away_team_id": away.json()["id"],
            "kickoff_datetime": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
            "venue": "AIMZ Training Ground",
            "status": "live",
        },
    )
    match_id = match.json()["id"]

    assisted = await client.post(
        f"/api/v1/matches/{match_id}/events",
        headers=admin_headers,
        json={
            "type": "goal",
            "minute": 19,
            "team_id": squad.json()["id"],
            "player_id": scorer.json()["id"],
            "secondary_player_id": provider.json()["id"],
            "client_operation_id": "combined-goal-1",
        },
    )
    assert assisted.status_code == 201, assisted.text
    assert assisted.json()["secondary_player_id"] == provider.json()["id"]

    # A goal with nobody credited is just as valid.
    solo = await client.post(
        f"/api/v1/matches/{match_id}/events",
        headers=admin_headers,
        json={
            "type": "goal",
            "minute": 55,
            "team_id": squad.json()["id"],
            "player_id": scorer.json()["id"],
            "client_operation_id": "combined-goal-2",
        },
    )
    assert solo.status_code == 201, solo.text
    assert solo.json()["secondary_player_id"] is None

    # One row per goal, not one per contribution.
    live = await client.get(f"/api/v1/matches/{match_id}/live", headers=admin_headers)
    assert [event["type"] for event in live.json()["events"]] == ["goal", "goal"]
    assert live.json()["match"]["home_score"] == 2

    # Season totals only count finished matches.
    finished = await client.post(
        f"/api/v1/matches/{match_id}/phase", headers=admin_headers, json={"action": "finish_match"}
    )
    assert finished.status_code == 200, finished.text

    # The provider is still credited, from the goal rather than an event of their own.
    stats = await client.get(
        f"/api/v1/players/{provider.json()['id']}/stats", headers=admin_headers
    )
    assert stats.json()["assists"] == 1
    assert stats.json()["goals"] == 0

    rejected = await client.post(
        f"/api/v1/matches/{match_id}/events",
        headers=admin_headers,
        json={
            "type": "assist",
            "minute": 60,
            "team_id": squad.json()["id"],
            "player_id": provider.json()["id"],
            "client_operation_id": "standalone-assist",
        },
    )
    assert rejected.status_code == 422


async def _match_fixture(
    client: AsyncClient,
    admin_headers: dict[str, str],
    label: str,
    *,
    status: str = "live",
) -> dict[str, str]:
    """A live match with one player on each side, built entirely through the API."""
    home = await client.post(
        "/api/v1/teams", headers=admin_headers, json={"name": f"AIMZ {label}", "is_aimz": True}
    )
    away = await client.post("/api/v1/teams", headers=admin_headers, json={"name": f"{label} FC"})
    competition = await client.post(
        "/api/v1/competitions",
        headers=admin_headers,
        json={"name": f"{label} League", "season": "2026/27", "type": "league"},
    )
    defender = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Nour Adel", "team_id": home.json()["id"], "position": "Defender"},
    )
    forward = await client.post(
        "/api/v1/players",
        headers=admin_headers,
        json={"name": "Habiba Tarek", "team_id": away.json()["id"], "position": "Forward"},
    )
    match = await client.post(
        "/api/v1/matches",
        headers=admin_headers,
        json={
            "competition_id": competition.json()["id"],
            "home_team_id": home.json()["id"],
            "away_team_id": away.json()["id"],
            "kickoff_datetime": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
            "venue": "AIMZ Training Ground",
            "status": status,
        },
    )
    assert match.status_code == 201, match.text
    return {
        "match_id": match.json()["id"],
        "competition_id": competition.json()["id"],
        "home_id": home.json()["id"],
        "away_id": away.json()["id"],
        "defender_id": defender.json()["id"],
        "forward_id": forward.json()["id"],
    }


@pytest.mark.asyncio
async def test_own_goal_credits_the_opponent_and_not_the_scorer(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _match_fixture(client, admin_headers, "Own Goal")
    # Filed against the team the scorer plays for, which is the home side here.
    logged = await client.post(
        f"/api/v1/matches/{ids['match_id']}/events",
        headers=admin_headers,
        json={
            "type": "own_goal",
            "minute": 22,
            "team_id": ids["home_id"],
            "player_id": ids["defender_id"],
            "client_operation_id": "own-goal-op-1",
        },
    )
    assert logged.status_code == 201, logged.text

    live = await client.get(f"/api/v1/matches/{ids['match_id']}/live", headers=admin_headers)
    # The goal counts for the away side even though it is filed against the home team.
    assert live.json()["match"]["home_score"] == 0
    assert live.json()["match"]["away_score"] == 1

    stats = await client.get(
        f"/api/v1/matches/{ids['match_id']}/player-stats", headers=admin_headers
    )
    scorer = next(row for row in stats.json() if row["player_id"] == ids["defender_id"])
    # An own goal never inflates a scoring record.
    assert scorer["goals"] == 0
    assert scorer["own_goals"] == 1


@pytest.mark.asyncio
async def test_missed_penalty_records_its_outcome_without_touching_the_score(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _match_fixture(client, admin_headers, "Missed Penalty")
    missed = await client.post(
        f"/api/v1/matches/{ids['match_id']}/events",
        headers=admin_headers,
        json={
            "type": "penalty_missed",
            "minute": 40,
            "team_id": ids["away_id"],
            "player_id": ids["forward_id"],
            "penalty_outcome": "saved",
            "client_operation_id": "missed-pen-op-1",
        },
    )
    assert missed.status_code == 201, missed.text
    assert missed.json()["penalty_outcome"] == "saved"

    live = await client.get(f"/api/v1/matches/{ids['match_id']}/live", headers=admin_headers)
    # A spot-kick that did not go in leaves the scoreline alone.
    assert live.json()["match"]["home_score"] == 0
    assert live.json()["match"]["away_score"] == 0
    stats = await client.get(
        f"/api/v1/matches/{ids['match_id']}/player-stats", headers=admin_headers
    )
    # A miss is not a counter, so it does not invent a stat row for the taker.
    assert [row for row in stats.json() if row["player_id"] == ids["forward_id"]] == []


@pytest.mark.asyncio
async def test_substitution_records_why_the_player_came_off(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _match_fixture(client, admin_headers, "Sub Reason")
    swap = await client.post(
        f"/api/v1/matches/{ids['match_id']}/events",
        headers=admin_headers,
        json={
            "type": "substitution",
            "minute": 55,
            "team_id": ids["home_id"],
            "player_id": ids["defender_id"],
            "substitution_reason": "injury",
            "client_operation_id": "sub-reason-op-1",
        },
    )
    assert swap.status_code == 201, swap.text
    assert swap.json()["substitution_reason"] == "injury"

    # The reason is optional, so a tactical change can leave it unset.
    plain = await client.post(
        f"/api/v1/matches/{ids['match_id']}/events",
        headers=admin_headers,
        json={
            "type": "substitution",
            "minute": 70,
            "team_id": ids["home_id"],
            "player_id": ids["defender_id"],
            "client_operation_id": "sub-reason-op-2",
        },
    )
    assert plain.status_code == 201, plain.text
    assert plain.json()["substitution_reason"] is None

    rejected = await client.post(
        f"/api/v1/matches/{ids['match_id']}/events",
        headers=admin_headers,
        json={
            "type": "substitution",
            "minute": 80,
            "team_id": ids["home_id"],
            "player_id": ids["defender_id"],
            "substitution_reason": "because",
            "client_operation_id": "sub-reason-op-3",
        },
    )
    assert rejected.status_code == 422


@pytest.mark.asyncio
async def test_man_of_the_match_needs_a_finished_match_and_an_appearance(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _match_fixture(client, admin_headers, "Award")
    award_url = f"/api/v1/matches/{ids['match_id']}/man-of-the-match"

    # A live match has no man of the match yet.
    too_early = await client.post(
        award_url, headers=admin_headers, json={"player_id": ids["defender_id"]}
    )
    assert too_early.status_code == 409

    await client.post(
        f"/api/v1/matches/{ids['match_id']}/phase",
        headers=admin_headers,
        json={"action": "finish_match"},
    )
    absent = await client.post(
        award_url, headers=admin_headers, json={"player_id": ids["defender_id"]}
    )
    # Nobody has been marked as having appeared, so the award has no candidates.
    assert absent.status_code == 422

    await client.put(
        f"/api/v1/matches/{ids['match_id']}/player-stats",
        headers=admin_headers,
        json=[{"player_id": ids["defender_id"], "appeared": True, "minutes_played": 90}],
    )
    named = await client.post(
        award_url, headers=admin_headers, json={"player_id": ids["defender_id"]}
    )
    assert named.status_code == 200, named.text
    assert named.json()["man_of_the_match_player_id"] == ids["defender_id"]

    cleared = await client.post(award_url, headers=admin_headers, json={"player_id": None})
    assert cleared.json()["man_of_the_match_player_id"] is None


@pytest.mark.asyncio
async def test_standings_carry_a_form_guide_and_head_to_head_reads_from_one_side(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _match_fixture(client, admin_headers, "Form", status="scheduled")
    operations = count()

    async def play(home_goals: int, away_goals: int) -> None:
        match = await client.post(
            "/api/v1/matches",
            headers=admin_headers,
            json={
                "competition_id": ids["competition_id"],
                "home_team_id": ids["home_id"],
                "away_team_id": ids["away_id"],
                "kickoff_datetime": (
                    datetime.now(UTC) + timedelta(hours=next(operations))
                ).isoformat(),
                "venue": "AIMZ Training Ground",
                "status": "live",
            },
        )
        match_id = match.json()["id"]
        for team_id, goals in ((ids["home_id"], home_goals), (ids["away_id"], away_goals)):
            for _ in range(goals):
                await client.post(
                    f"/api/v1/matches/{match_id}/events",
                    headers=admin_headers,
                    json={
                        "type": "goal",
                        "minute": 10,
                        "team_id": team_id,
                        "client_operation_id": f"form-op-{next(operations)}-{match_id[:8]}",
                    },
                )
        await client.post(
            f"/api/v1/matches/{match_id}/phase",
            headers=admin_headers,
            json={"action": "finish_match"},
        )

    await play(3, 0)
    await play(0, 1)
    await play(2, 2)

    table = await client.get(
        f"/api/v1/competitions/{ids['competition_id']}/standings", headers=admin_headers
    )
    assert table.status_code == 200, table.text
    home_row = next(row for row in table.json() if row["team"]["id"] == ids["home_id"])
    # Newest result first: drew, then lost, then won.
    assert home_row["form"] == ["D", "L", "W"]
    assert home_row["played"] == 3

    h2h = await client.get(
        f"/api/v1/teams/{ids['home_id']}/head-to-head/{ids['away_id']}", headers=admin_headers
    )
    assert h2h.status_code == 200, h2h.text
    assert (h2h.json()["won"], h2h.json()["drawn"], h2h.json()["lost"]) == (1, 1, 1)
    assert h2h.json()["goals_for"] == 5
    assert h2h.json()["goals_against"] == 3
    # The same fixtures read the other way round from the opponent's side.
    reverse = await client.get(
        f"/api/v1/teams/{ids['away_id']}/head-to-head/{ids['home_id']}", headers=admin_headers
    )
    assert (reverse.json()["won"], reverse.json()["lost"]) == (1, 1)
    assert reverse.json()["goals_for"] == 3


@pytest.mark.asyncio
async def test_card_leaders_and_season_awards(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _match_fixture(client, admin_headers, "Awards")
    for index, event_type in enumerate(("yellow_card", "yellow_card", "red_card")):
        await client.post(
            f"/api/v1/matches/{ids['match_id']}/events",
            headers=admin_headers,
            json={
                "type": event_type,
                "minute": 20 + index,
                "team_id": ids["away_id"],
                "player_id": ids["forward_id"],
                "client_operation_id": f"card-op-{index}",
            },
        )
    await client.post(
        f"/api/v1/matches/{ids['match_id']}/events",
        headers=admin_headers,
        json={
            "type": "goal",
            "minute": 5,
            "team_id": ids["home_id"],
            "player_id": ids["defender_id"],
            "client_operation_id": "awards-goal-op",
        },
    )
    await client.post(
        f"/api/v1/matches/{ids['match_id']}/phase",
        headers=admin_headers,
        json={"action": "finish_match"},
    )

    leaders = await client.get("/api/v1/stats/leaders?metric=cards", headers=admin_headers)
    assert leaders.status_code == 200, leaders.text
    top = leaders.json()[0]
    assert top["player"]["id"] == ids["forward_id"]
    assert (top["yellow_cards"], top["red_cards"]) == (2, 1)

    # Filtering by competition keeps another competition's cards out.
    scoped = await client.get(
        f"/api/v1/stats/leaders?metric=cards&competition_id={ids['competition_id']}",
        headers=admin_headers,
    )
    assert [row["player"]["id"] for row in scoped.json()] == [ids["forward_id"]]

    awards = await client.get(
        f"/api/v1/competitions/{ids['competition_id']}/awards", headers=admin_headers
    )
    assert awards.status_code == 200, awards.text
    labels = {award["label"]: award for award in awards.json()["player_awards"]}
    assert labels["Top scorer"]["player"]["id"] == ids["defender_id"]
    assert labels["Top scorer"]["value"] == 1
    # The home team conceded nothing, so it takes the clean-sheet award.
    sheets = awards.json()["team_awards"][0]
    assert sheets["team"]["id"] == ids["home_id"]
    assert sheets["value"] == 1


@pytest.mark.asyncio
async def test_audit_log_attributes_each_change_to_the_acting_admin(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ids = await _match_fixture(client, admin_headers, "Audit")
    added = await client.post(
        f"/api/v1/matches/{ids['match_id']}/events",
        headers=admin_headers,
        json={
            "type": "goal",
            "minute": 8,
            "team_id": ids["home_id"],
            "player_id": ids["defender_id"],
            "client_operation_id": "audit-op-1",
        },
    )
    await client.delete(
        f"/api/v1/matches/{ids['match_id']}/events/{added.json()['id']}", headers=admin_headers
    )

    trail = await client.get(
        f"/api/v1/admin/audit-log?match_id={ids['match_id']}", headers=admin_headers
    )
    assert trail.status_code == 200, trail.text
    actions = [entry["action"] for entry in trail.json()["items"]]
    assert "event_added" in actions
    assert "event_removed" in actions
    assert all(entry["actor_name"] for entry in trail.json()["items"])

    # A player cannot read the trail.
    await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Curious Player",
            "email": "curious@aimz.example.com",
            "password": "long-secure-password",
            "invite_code": "AIMZ-TEST",
        },
    )
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "curious@aimz.example.com", "password": "long-secure-password"},
    )
    forbidden = await client.get(
        "/api/v1/admin/audit-log",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert forbidden.status_code == 403
