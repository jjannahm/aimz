from collections import defaultdict
from typing import Literal

from fastapi import APIRouter
from sqlalchemy import case, func, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, SessionDep
from app.core.errors import api_error
from app.db.models import (
    Competition,
    CompetitionType,
    Match,
    MatchStatus,
    Player,
    PlayerMatchStat,
    Team,
)
from app.schemas import (
    PlayerLeaderRow,
    PlayerMatchStatRead,
    PlayerRead,
    PlayerSeasonSummary,
    StandingRow,
    TeamRead,
)

router = APIRouter()


@router.get("/competitions/{competition_id}/standings", response_model=list[StandingRow])
async def standings(competition_id: str, _: CurrentUser, session: SessionDep) -> list[StandingRow]:
    competition = await session.get(Competition, competition_id)
    if competition is None:
        raise api_error(404, "competition_not_found", "Competition not found.")
    if competition.type == CompetitionType.friendly:
        raise api_error(422, "standings_unavailable", "Friendlies do not have standings.")
    matches = list(
        (
            await session.scalars(
                select(Match)
                .where(Match.competition_id == competition_id, Match.status == MatchStatus.finished)
                .options(selectinload(Match.home_team), selectinload(Match.away_team))
            )
        ).all()
    )
    table: dict[str, dict[str, int]] = defaultdict(
        lambda: {"played": 0, "won": 0, "drawn": 0, "lost": 0, "gf": 0, "ga": 0, "points": 0}
    )
    teams: dict[str, Team] = {}
    for match in matches:
        teams[match.home_team_id] = match.home_team
        teams[match.away_team_id] = match.away_team
        home, away = table[match.home_team_id], table[match.away_team_id]
        home["played"] += 1
        away["played"] += 1
        home["gf"] += match.home_score
        home["ga"] += match.away_score
        away["gf"] += match.away_score
        away["ga"] += match.home_score
        if match.home_score > match.away_score:
            home["won"] += 1
            away["lost"] += 1
            home["points"] += 3
        elif match.home_score < match.away_score:
            away["won"] += 1
            home["lost"] += 1
            away["points"] += 3
        else:
            home["drawn"] += 1
            away["drawn"] += 1
            home["points"] += 1
            away["points"] += 1
    ordered = sorted(
        table,
        key=lambda team_id: (
            -table[team_id]["points"],
            -(table[team_id]["gf"] - table[team_id]["ga"]),
            -table[team_id]["gf"],
            teams[team_id].name.lower(),
        ),
    )
    return [
        StandingRow(
            rank=index,
            team=TeamRead.model_validate(teams[team_id]),
            played=table[team_id]["played"],
            won=table[team_id]["won"],
            drawn=table[team_id]["drawn"],
            lost=table[team_id]["lost"],
            goals_for=table[team_id]["gf"],
            goals_against=table[team_id]["ga"],
            goal_difference=table[team_id]["gf"] - table[team_id]["ga"],
            points=table[team_id]["points"],
        )
        for index, team_id in enumerate(ordered, start=1)
    ]


@router.get("/players/{player_id}/stats", response_model=PlayerSeasonSummary)
async def player_stats(
    player_id: str, _: CurrentUser, session: SessionDep, season: str | None = None
) -> PlayerSeasonSummary:
    player = await session.get(Player, player_id)
    if player is None:
        raise api_error(404, "player_not_found", "Player not found.")
    query = (
        select(PlayerMatchStat)
        .join(Match)
        .join(Competition)
        .where(PlayerMatchStat.player_id == player_id, Match.status == MatchStatus.finished)
        .order_by(Match.kickoff_datetime.desc())
    )
    if season:
        query = query.where(Competition.season == season)
    rows = list((await session.scalars(query)).all())
    return PlayerSeasonSummary(
        player=PlayerRead.model_validate(player),
        season=season,
        appearances=sum(row.appeared for row in rows),
        minutes_played=sum(row.minutes_played for row in rows),
        goals=sum(row.goals for row in rows),
        assists=sum(row.assists for row in rows),
        yellow_cards=sum(row.yellow_cards for row in rows),
        red_cards=sum(row.red_cards for row in rows),
        matches=[PlayerMatchStatRead.model_validate(row) for row in rows],
    )


@router.get("/stats/leaders", response_model=list[PlayerLeaderRow])
async def stat_leaders(
    _: CurrentUser,
    session: SessionDep,
    metric: Literal["goals", "assists"] = "goals",
    age_group: str | None = None,
    season: str | None = None,
    limit: int = 20,
) -> list[PlayerLeaderRow]:
    """Rank players by goals or assists across finished matches."""
    limit = max(1, min(limit, 100))
    query = (
        select(
            Player,
            Team,
            func.sum(PlayerMatchStat.goals).label("goals"),
            func.sum(PlayerMatchStat.assists).label("assists"),
            func.sum(case((PlayerMatchStat.appeared, 1), else_=0)).label("appearances"),
        )
        .select_from(PlayerMatchStat)
        .join(Match, Match.id == PlayerMatchStat.match_id)
        .join(Player, Player.id == PlayerMatchStat.player_id)
        .join(Team, Team.id == Player.team_id)
        .where(Match.status == MatchStatus.finished)
        .group_by(Player.id, Team.id)
    )
    if age_group:
        query = query.where(Team.age_group == age_group)
    if season:
        query = query.join(Competition, Competition.id == Match.competition_id).where(
            Competition.season == season
        )
    scored = lambda row: row.goals if metric == "goals" else row.assists  # noqa: E731
    rows = [row for row in (await session.execute(query)).all() if scored(row) > 0]
    ranked = sorted(
        rows,
        key=lambda row: (
            -scored(row),
            -(row.assists if metric == "goals" else row.goals),
            row.appearances,
            row[0].name.lower(),
        ),
    )[:limit]
    return [
        PlayerLeaderRow(
            rank=index,
            player=PlayerRead.model_validate(row[0]),
            team=TeamRead.model_validate(row[1]),
            goals=row.goals,
            assists=row.assists,
            appearances=row.appearances,
        )
        for index, row in enumerate(ranked, start=1)
    ]
