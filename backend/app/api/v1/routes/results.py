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
    CompetitionRead,
    HeadToHead,
    HeadToHeadMeeting,
    PlayerAward,
    PlayerLeaderRow,
    PlayerMatchStatRead,
    PlayerRead,
    PlayerSeasonSummary,
    SeasonAwards,
    StandingRow,
    TeamRead,
)

router = APIRouter()

# How many recent results the form guide shows.
FORM_LENGTH = 5
# A one-match wonder should not win a discipline award.
MIN_AWARD_APPEARANCES = 3


def outcome(scored: int, conceded: int) -> str:
    if scored > conceded:
        return "W"
    return "D" if scored == conceded else "L"


async def finished_matches(session: SessionDep, competition_id: str) -> list[Match]:
    """Finished matches in a competition, oldest first so form reads in order."""
    return list(
        (
            await session.scalars(
                select(Match)
                .where(Match.competition_id == competition_id, Match.status == MatchStatus.finished)
                .order_by(Match.kickoff_datetime)
                .options(selectinload(Match.home_team), selectinload(Match.away_team))
            )
        ).all()
    )


@router.get("/competitions/{competition_id}/standings", response_model=list[StandingRow])
async def standings(competition_id: str, _: CurrentUser, session: SessionDep) -> list[StandingRow]:
    competition = await session.get(Competition, competition_id)
    if competition is None:
        raise api_error(404, "competition_not_found", "Competition not found.")
    if competition.type == CompetitionType.friendly:
        raise api_error(422, "standings_unavailable", "Friendlies do not have standings.")
    matches = await finished_matches(session, competition_id)
    table: dict[str, dict[str, int]] = defaultdict(
        lambda: {"played": 0, "won": 0, "drawn": 0, "lost": 0, "gf": 0, "ga": 0, "points": 0}
    )
    # Oldest first while accumulating; reversed per team at the end so the strip
    # reads newest first.
    form: dict[str, list[str]] = defaultdict(list)
    teams: dict[str, Team] = {}
    # Teams entered in the competition appear on nil rather than waiting for a
    # first result, so the table reads as a league from the day it is drawn up.
    for entered in (
        await session.scalars(select(Team).where(Team.competition_id == competition_id))
    ).all():
        teams[entered.id] = entered
        table[entered.id]
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
        form[match.home_team_id].append(outcome(match.home_score, match.away_score))
        form[match.away_team_id].append(outcome(match.away_score, match.home_score))
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
            form=list(reversed(form[team_id]))[:FORM_LENGTH],
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


@router.get("/teams/{team_id}/head-to-head/{opponent_id}", response_model=HeadToHead)
async def head_to_head(
    team_id: str, opponent_id: str, _: CurrentUser, session: SessionDep
) -> HeadToHead:
    """Every finished meeting between two teams, from the first team's side."""
    if team_id == opponent_id:
        raise api_error(422, "same_team", "Pick two different teams.")
    team = await session.get(Team, team_id)
    opponent = await session.get(Team, opponent_id)
    if team is None or opponent is None:
        raise api_error(404, "team_not_found", "Team not found.")
    pairing = (
        (Match.home_team_id == team_id) & (Match.away_team_id == opponent_id),
        (Match.home_team_id == opponent_id) & (Match.away_team_id == team_id),
    )
    matches = list(
        (
            await session.scalars(
                select(Match)
                .where(Match.status == MatchStatus.finished, pairing[0] | pairing[1])
                .order_by(Match.kickoff_datetime.desc())
                .options(
                    selectinload(Match.home_team),
                    selectinload(Match.away_team),
                    selectinload(Match.competition),
                )
            )
        ).all()
    )
    tally = {"won": 0, "drawn": 0, "lost": 0, "gf": 0, "ga": 0}
    meetings: list[HeadToHeadMeeting] = []
    for match in matches:
        at_home = match.home_team_id == team_id
        scored = match.home_score if at_home else match.away_score
        conceded = match.away_score if at_home else match.home_score
        tally["gf"] += scored
        tally["ga"] += conceded
        tally[{"W": "won", "D": "drawn", "L": "lost"}[outcome(scored, conceded)]] += 1
        meetings.append(
            HeadToHeadMeeting(
                match_id=match.id,
                kickoff_datetime=match.kickoff_datetime,
                competition=(
                    CompetitionRead.model_validate(match.competition) if match.competition else None
                ),
                home_team=TeamRead.model_validate(match.home_team) if match.home_team else None,
                away_team=TeamRead.model_validate(match.away_team) if match.away_team else None,
                home_score=match.home_score,
                away_score=match.away_score,
                result=outcome(scored, conceded),
            )
        )
    return HeadToHead(
        team=TeamRead.model_validate(team),
        opponent=TeamRead.model_validate(opponent),
        played=len(matches),
        won=tally["won"],
        drawn=tally["drawn"],
        lost=tally["lost"],
        goals_for=tally["gf"],
        goals_against=tally["ga"],
        meetings=meetings,
    )


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
        own_goals=sum(row.own_goals for row in rows),
        yellow_cards=sum(row.yellow_cards for row in rows),
        red_cards=sum(row.red_cards for row in rows),
        matches=[PlayerMatchStatRead.model_validate(row) for row in rows],
    )


@router.get("/stats/leaders", response_model=list[PlayerLeaderRow])
async def stat_leaders(
    _: CurrentUser,
    session: SessionDep,
    metric: Literal["goals", "assists", "cards"] = "goals",
    age_group: str | None = None,
    season: str | None = None,
    competition_id: str | None = None,
    limit: int = 20,
) -> list[PlayerLeaderRow]:
    """Rank players by goals, assists, or cards collected, across finished matches."""
    limit = max(1, min(limit, 100))
    query = (
        select(
            Player,
            Team,
            func.sum(PlayerMatchStat.goals).label("goals"),
            func.sum(PlayerMatchStat.assists).label("assists"),
            func.sum(PlayerMatchStat.yellow_cards).label("yellow_cards"),
            func.sum(PlayerMatchStat.red_cards).label("red_cards"),
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
    if competition_id:
        query = query.where(Match.competition_id == competition_id)
    if season:
        # Joined once here; competition_id filters on the match instead, so the
        # two filters never add the same join twice.
        query = query.join(Competition, Competition.id == Match.competition_id).where(
            Competition.season == season
        )

    def scored(row: object) -> int:
        if metric == "goals":
            return row.goals
        if metric == "assists":
            return row.assists
        # A sending-off weighs more than a caution.
        return row.yellow_cards + row.red_cards * 3

    def tiebreak(row: object) -> int:
        if metric == "goals":
            return row.assists
        if metric == "assists":
            return row.goals
        return row.red_cards

    rows = [row for row in (await session.execute(query)).all() if scored(row) > 0]
    ranked = sorted(
        rows,
        key=lambda row: (-scored(row), -tiebreak(row), row.appearances, row[0].name.lower()),
    )[:limit]
    return [
        PlayerLeaderRow(
            rank=index,
            player=PlayerRead.model_validate(row[0]),
            team=TeamRead.model_validate(row[1]),
            goals=row.goals,
            assists=row.assists,
            yellow_cards=row.yellow_cards,
            red_cards=row.red_cards,
            appearances=row.appearances,
        )
        for index, row in enumerate(ranked, start=1)
    ]


@router.get("/competitions/{competition_id}/awards", response_model=SeasonAwards)
async def season_awards(
    competition_id: str, _: CurrentUser, session: SessionDep
) -> SeasonAwards:
    """Season honours, drawn from finished matches in one competition."""
    competition = await session.get(Competition, competition_id)
    if competition is None:
        raise api_error(404, "competition_not_found", "Competition not found.")
    # Awards are counted on the match, not on a player_match_stats row, so this
    # one is a correlated subquery rather than another sum. It comes last in the
    # select because best() reads Player and Team off positions 0 and 1.
    motm = (
        select(func.count())
        .select_from(Match)
        .where(
            Match.competition_id == competition_id,
            Match.status == MatchStatus.finished,
            Match.man_of_the_match_player_id == Player.id,
        )
        .correlate(Player)
        .scalar_subquery()
        .label("motm")
    )
    totals = (
        await session.execute(
            select(
                Player,
                Team,
                func.sum(PlayerMatchStat.goals).label("goals"),
                func.sum(PlayerMatchStat.assists).label("assists"),
                func.sum(PlayerMatchStat.minutes_played).label("minutes"),
                func.sum(PlayerMatchStat.yellow_cards + PlayerMatchStat.red_cards).label("cards"),
                func.sum(case((PlayerMatchStat.appeared, 1), else_=0)).label("appearances"),
                motm,
            )
            .select_from(PlayerMatchStat)
            .join(Match, Match.id == PlayerMatchStat.match_id)
            .join(Player, Player.id == PlayerMatchStat.player_id)
            .join(Team, Team.id == Player.team_id)
            .where(Match.status == MatchStatus.finished, Match.competition_id == competition_id)
            .group_by(Player.id, Team.id)
        )
    ).all()

    def best(label: str, value: object, unit: str, floor: int = 1) -> PlayerAward | None:
        candidates = [row for row in totals if getattr(row, value) >= floor]
        if not candidates:
            return None
        winner = max(candidates, key=lambda row: (getattr(row, value), -row.appearances))
        return PlayerAward(
            label=label,
            player=PlayerRead.model_validate(winner[0]),
            team=TeamRead.model_validate(winner[1]),
            value=getattr(winner, value),
            unit=unit,
        )

    player_awards = [
        award
        for award in (
            best("Most man of the match", "motm", "awards"),
            best("Top scorer", "goals", "goals"),
            best("Most assists", "assists", "assists"),
            best("Most appearances", "appearances", "appearances"),
            best("Most minutes", "minutes", "minutes"),
        )
        if award is not None
    ]
    # Fewest cards, not most: the cleanest record among regulars.
    regulars = [row for row in totals if row.appearances >= MIN_AWARD_APPEARANCES]
    if regulars:
        cleanest = min(regulars, key=lambda row: (row.cards, -row.appearances))
        player_awards.append(
            PlayerAward(
                label="Best discipline",
                player=PlayerRead.model_validate(cleanest[0]),
                team=TeamRead.model_validate(cleanest[1]),
                value=cleanest.cards,
                unit="cards",
            )
        )

    # Every award is now a player award; team_awards stays on the schema, and
    # empty, so the response shape does not change for older clients.
    return SeasonAwards(
        competition=CompetitionRead.model_validate(competition),
        player_awards=player_awards,
    )
