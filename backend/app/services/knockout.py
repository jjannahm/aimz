"""Knockout group tables and bracket, ported from the Worker's knockout.ts."""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    BracketSlot,
    Competition,
    CompetitionGroup,
    Match,
    MatchStatus,
    Team,
)
from app.services.knockout_shape import (
    GROUP_SIZE,
    group_count_for,
    rounds_for,
)


def group_size_of(competition: Competition) -> int:
    """A competition drawn before custom shapes existed was drawn in fours."""
    return competition.group_size or GROUP_SIZE


def _group_name(position: int) -> str:
    return f"Group {chr(65 + position)}"


def generate_structure(
    session: AsyncSession, competition: Competition, team_count: int, group_size: int
) -> None:
    """Add every group and (empty) bracket slot a new knockout starts with."""
    group_count = group_count_for(team_count, group_size)
    for position in range(group_count):
        session.add(
            CompetitionGroup(
                competition_id=competition.id,
                name=_group_name(position),
                position=position,
            )
        )
    for round_size in rounds_for(group_count):
        for position in range(round_size // 2):
            session.add(
                BracketSlot(
                    competition_id=competition.id,
                    round=round_size,
                    position=position,
                )
            )


def _outcome(scored: int, conceded: int) -> str:
    if scored > conceded:
        return "W"
    return "D" if scored == conceded else "L"


@dataclass
class GroupStanding:
    team: Team
    played: int = 0
    won: int = 0
    drawn: int = 0
    lost: int = 0
    goals_for: int = 0
    goals_against: int = 0
    points: int = 0
    form: list[str] = field(default_factory=list)


async def group_standings(
    session: AsyncSession, competition_id: str
) -> dict[str, list[GroupStanding]]:
    """Group tables, computed the same way the league table is. Only matches
    between two teams of the same group count."""
    teams = list(
        (
            await session.scalars(
                select(Team).where(Team.competition_id == competition_id)
            )
        ).all()
    )
    matches = list(
        (
            await session.scalars(
                select(Match)
                .where(
                    Match.competition_id == competition_id,
                    Match.status == MatchStatus.finished,
                )
                .order_by(Match.kickoff_datetime)
            )
        ).all()
    )
    group_of = {team.id: team.competition_group_id for team in teams}
    rows = {team.id: GroupStanding(team=team) for team in teams}

    for match in matches:
        home_group = group_of.get(match.home_team_id)
        if home_group is None or home_group != group_of.get(match.away_team_id):
            continue
        for team_id, scored, conceded in (
            (match.home_team_id, match.home_score, match.away_score),
            (match.away_team_id, match.away_score, match.home_score),
        ):
            row = rows.get(team_id)
            if row is None:
                continue
            row.played += 1
            row.goals_for += scored
            row.goals_against += conceded
            row.form.append(_outcome(scored, conceded))
            if scored > conceded:
                row.won += 1
                row.points += 3
            elif scored == conceded:
                row.drawn += 1
                row.points += 1
            else:
                row.lost += 1

    by_group: dict[str, list[GroupStanding]] = {}
    for row in rows.values():
        key = row.team.competition_group_id or ""
        by_group.setdefault(key, []).append(row)
    for standings in by_group.values():
        standings.sort(
            key=lambda r: (
                -r.points,
                -(r.goals_for - r.goals_against),
                -r.goals_for,
                r.team.name.lower(),
            )
        )
    return by_group
