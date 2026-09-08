from fastapi import APIRouter
from sqlalchemy import select, update

from app.api.deps import AdminUser, CurrentUser, SessionDep
from app.core.errors import api_error
from app.db.models import BracketSlot, Competition, CompetitionGroup, Team
from app.schemas import (
    AdvanceInput,
    BracketRead,
    BracketRound,
    BracketSlotRead,
    BracketSlotUpdate,
    GroupRead,
    GroupTeamRef,
    TeamRead,
)
from app.services.competitions import require_open_competition
from app.services.knockout import group_size_of, group_standings
from app.services.knockout_shape import (
    ADVANCE_PER_GROUP,
    group_count_for,
    round_label,
    rounds_for,
)

router = APIRouter()


async def _competition_or_404(session: SessionDep, competition_id: str) -> Competition:
    competition = await session.get(Competition, competition_id)
    if competition is None:
        raise api_error(404, "competition_not_found", "Competition not found.")
    return competition


async def _read_bracket(session: SessionDep, competition: Competition) -> BracketRead:
    if competition.team_count is None:
        return BracketRead(competition_id=competition.id, team_count=None, rounds=[])
    slots = list(
        (
            await session.scalars(
                select(BracketSlot)
                .where(BracketSlot.competition_id == competition.id)
                .order_by(BracketSlot.round.desc(), BracketSlot.position.asc())
            )
        ).all()
    )
    team_ids = {
        team_id
        for slot in slots
        for team_id in (slot.home_team_id, slot.away_team_id)
        if team_id
    }
    teams = (
        {
            team.id: team
            for team in (
                await session.scalars(select(Team).where(Team.id.in_(team_ids)))
            ).all()
        }
        if team_ids
        else {}
    )

    def team_read(team_id: str | None) -> TeamRead | None:
        team = teams.get(team_id) if team_id else None
        return TeamRead.model_validate(team) if team else None

    group_count = group_count_for(competition.team_count, group_size_of(competition))
    rounds = [
        BracketRound(
            round=round_size,
            label=round_label(round_size),
            slots=[
                BracketSlotRead(
                    id=slot.id,
                    round=slot.round,
                    position=slot.position,
                    home_team=team_read(slot.home_team_id),
                    away_team=team_read(slot.away_team_id),
                    winner_team_id=slot.winner_team_id,
                    match_id=slot.match_id,
                )
                for slot in slots
                if slot.round == round_size
            ],
        )
        for round_size in rounds_for(group_count)
    ]
    return BracketRead(
        competition_id=competition.id, team_count=competition.team_count, rounds=rounds
    )


@router.get("/competitions/{competition_id}/groups", response_model=list[GroupRead])
async def list_groups(
    competition_id: str, _: CurrentUser, session: SessionDep
) -> list[GroupRead]:
    competition = await _competition_or_404(session, competition_id)
    if competition.team_count is None:
        return []
    groups = list(
        (
            await session.scalars(
                select(CompetitionGroup)
                .where(CompetitionGroup.competition_id == competition_id)
                .order_by(CompetitionGroup.position)
            )
        ).all()
    )
    teams = list(
        (
            await session.scalars(
                select(Team).where(Team.competition_id == competition_id)
            )
        ).all()
    )
    return [
        GroupRead(
            id=group.id,
            competition_id=group.competition_id,
            name=group.name,
            position=group.position,
            teams=[
                TeamRead.model_validate(team)
                for team in teams
                if team.competition_group_id == group.id
            ],
        )
        for group in groups
    ]


@router.put(
    "/competitions/{competition_id}/groups/{group_id}/teams",
    response_model=GroupRead,
)
async def set_group_teams(
    competition_id: str,
    group_id: str,
    payload: list[GroupTeamRef],
    _: AdminUser,
    session: SessionDep,
) -> GroupRead:
    competition = await _competition_or_404(session, competition_id)
    require_open_competition(competition)
    group = await session.scalar(
        select(CompetitionGroup).where(
            CompetitionGroup.id == group_id,
            CompetitionGroup.competition_id == competition_id,
        )
    )
    if group is None:
        raise api_error(404, "group_not_found", "Group not found.")
    capacity = group_size_of(competition)
    if len(payload) > capacity:
        raise api_error(
            422,
            "validation_error",
            "Check the highlighted fields.",
            field_errors=[
                {"field": "teams", "message": f"A group holds at most {capacity} teams."}
            ],
        )
    # Everyone drawn out of this group loses their place in it.
    await session.execute(
        update(Team)
        .where(Team.competition_group_id == group_id)
        .values(competition_group_id=None)
    )
    for ref in payload:
        await session.execute(
            update(Team)
            .where(Team.id == ref.team_id)
            .values(competition_id=competition_id, competition_group_id=group_id)
        )
    await session.commit()
    members = list(
        (
            await session.scalars(
                select(Team).where(Team.competition_group_id == group_id)
            )
        ).all()
    )
    return GroupRead(
        id=group.id,
        competition_id=group.competition_id,
        name=group.name,
        position=group.position,
        teams=[TeamRead.model_validate(team) for team in members],
    )


@router.get("/competitions/{competition_id}/bracket", response_model=BracketRead)
async def get_bracket(
    competition_id: str, _: CurrentUser, session: SessionDep
) -> BracketRead:
    return await _read_bracket(session, await _competition_or_404(session, competition_id))


@router.post("/competitions/{competition_id}/advance", response_model=BracketRead)
async def advance_round(
    competition_id: str, payload: AdvanceInput, _: AdminUser, session: SessionDep
) -> BracketRead:
    competition = await _competition_or_404(session, competition_id)
    require_open_competition(competition)
    if competition.team_count is None:
        raise api_error(409, "not_a_knockout", "This competition has no knockout stage.")
    group_count = group_count_for(competition.team_count, group_size_of(competition))
    if payload.round not in rounds_for(group_count):
        raise api_error(
            422,
            "validation_error",
            "Check the highlighted fields.",
            field_errors=[
                {"field": "round", "message": "Choose a round of this competition."}
            ],
        )
    target = list(
        (
            await session.scalars(
                select(BracketSlot)
                .where(
                    BracketSlot.competition_id == competition_id,
                    BracketSlot.round == payload.round,
                )
                .order_by(BracketSlot.position)
            )
        ).all()
    )
    if any(slot.winner_team_id for slot in target):
        raise api_error(
            409,
            "round_locked",
            "This round already has a result. Clear it before drawing it again.",
        )

    pairs: list[tuple[str | None, str | None]] = []
    if payload.round == group_count * ADVANCE_PER_GROUP:
        groups = list(
            (
                await session.scalars(
                    select(CompetitionGroup)
                    .where(CompetitionGroup.competition_id == competition_id)
                    .order_by(CompetitionGroup.position)
                )
            ).all()
        )
        tables = await group_standings(session, competition_id)
        winners: list[str | None] = []
        runners_up: list[str | None] = []
        for group in groups:
            table = tables.get(group.id, [])
            if len([row for row in table if row.played > 0]) < 2:
                raise api_error(
                    409,
                    "groups_incomplete",
                    "Every group needs results before its top two can advance.",
                )
            winners.append(table[0].team.id if len(table) > 0 else None)
            runners_up.append(table[1].team.id if len(table) > 1 else None)
        # A group winner meets the runner-up from the next group along.
        for position in range(len(winners)):
            pairs.append(
                (winners[position], runners_up[(position + 1) % len(runners_up)])
            )
    else:
        source = list(
            (
                await session.scalars(
                    select(BracketSlot)
                    .where(
                        BracketSlot.competition_id == competition_id,
                        BracketSlot.round == payload.round * 2,
                    )
                    .order_by(BracketSlot.position)
                )
            ).all()
        )
        if any(slot.winner_team_id is None for slot in source):
            raise api_error(
                409,
                "round_incomplete",
                "Every tie in the previous round needs a winner first.",
            )
        for position in range(0, len(source), 2):
            pairs.append(
                (
                    source[position].winner_team_id,
                    source[position + 1].winner_team_id
                    if position + 1 < len(source)
                    else None,
                )
            )

    for index, slot in enumerate(target):
        home, away = pairs[index] if index < len(pairs) else (None, None)
        slot.home_team_id = home
        slot.away_team_id = away
    await session.commit()
    return await _read_bracket(session, competition)


@router.patch("/bracket-slots/{slot_id}", response_model=BracketRead)
async def update_slot(
    slot_id: str, payload: BracketSlotUpdate, _: AdminUser, session: SessionDep
) -> BracketRead:
    slot = await session.get(BracketSlot, slot_id)
    if slot is None:
        raise api_error(404, "slot_not_found", "Bracket tie not found.")
    require_open_competition(await _competition_or_404(session, slot.competition_id))
    provided = payload.model_fields_set
    winner = payload.winner_team_id if "winner_team_id" in provided else slot.winner_team_id
    match_id = payload.match_id if "match_id" in provided else slot.match_id
    if winner and winner not in {slot.home_team_id, slot.away_team_id}:
        raise api_error(
            422,
            "validation_error",
            "Check the highlighted fields.",
            field_errors=[
                {
                    "field": "winner_team_id",
                    "message": "The winner must be one of the two teams in this tie.",
                }
            ],
        )
    slot.winner_team_id = winner
    slot.match_id = match_id
    await session.commit()
    competition = await _competition_or_404(session, slot.competition_id)
    return await _read_bracket(session, competition)
