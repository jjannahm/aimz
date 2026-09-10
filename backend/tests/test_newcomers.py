import pytest
from httpx import AsyncClient


def application(submission_id: str, *, email: str = "newcomer@example.com") -> dict[str, object]:
    return {
        "client_submission_id": submission_id,
        "turnstile_token": "development-bypass",
        "branch": "AUC (East)",
        "full_name": "New Player",
        "mobile": "+201001112233",
        "email": email,
        "whatsapp_mobile": "+201001112233",
        "date_of_birth": "2012-05-04",
        "nationality": "Egyptian",
        "address": "New Cairo",
        "previous_academy": "None",
        "school_university": "AIMZ School",
        "father_name": "Father Player",
        "father_mobile": "+201009998877",
        "mother_name": "Mother Player",
        "mother_mobile": "+201008887766",
        "medical_concerns": "None",
        "medications": "None",
        "consent": True,
        "consent_version": "2026-09",
    }


@pytest.mark.asyncio
async def test_public_submission_is_idempotent_and_flags_duplicates(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    first = await client.post("/api/v1/newcomer-applications", json=application("submission-one"))
    assert first.status_code == 201, first.text
    replay = await client.post("/api/v1/newcomer-applications", json=application("submission-one"))
    assert replay.status_code == 201
    assert replay.json()["id"] == first.json()["id"]
    second = await client.post(
        "/api/v1/newcomer-applications",
        json=application("submission-two", email="sibling@example.com"),
    )
    assert second.status_code == 201
    assert second.json()["id"] != first.json()["id"]
    assert second.json()["duplicate_likely"] is True

    listed = await client.get("/api/v1/admin/newcomers", headers=admin_headers)
    assert listed.status_code == 200
    assert listed.json()["total"] == 2


@pytest.mark.asyncio
async def test_assignment_creates_player_contacts_and_one_time_invite(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    created = await client.post("/api/v1/newcomer-applications", json=application("assignment-one"))
    team = await client.post(
        "/api/v1/teams",
        headers=admin_headers,
        json={"name": "AIMZ U14", "age_group": "U14", "is_aimz": True},
    )
    assert team.status_code == 201, team.text
    assigned = await client.post(
        f"/api/v1/admin/newcomers/{created.json()['id']}/assign-and-confirm",
        headers=admin_headers,
        json={"team_id": team.json()["id"], "position": "CM", "jersey_number": 8},
    )
    assert assigned.status_code == 200, assigned.text
    body = assigned.json()
    assert body["application"]["outcome"] == "joined"
    assert body["invitation"]["code"].count("-") == 2
    assert "0" not in body["invitation"]["code"]
    assert body["invitation"]["share_url"].endswith(body["invitation"]["code"].replace("-", ""))


@pytest.mark.asyncio
async def test_closed_pipeline_requires_an_outcome(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    created = await client.post("/api/v1/newcomer-applications", json=application("pipeline-one"))
    response = await client.patch(
        f"/api/v1/admin/newcomers/{created.json()['id']}",
        headers=admin_headers,
        json={"stage": "closed"},
    )
    assert response.status_code == 422
