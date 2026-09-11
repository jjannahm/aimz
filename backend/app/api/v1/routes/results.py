from collections import defaultdict
from typing import Literal

from fastapi import APIRouter
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import aliased, selectinload

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
    AwardRankRow,
    CompetitionRead,
    HeadToHead,
    HeadToHeadMeeting,
    PlayerAward,
    PlayerCompetitionSummary,
    PlayerHonour,
    PlayerHonours,
    PlayerLeaderRow,
    PlayerMatchStatRead,
    PlayerRead,
    PlayerSeasonSummary,
    SeasonAwards,
    SquadStatRow,
    StandingRow,
    TeamRead,
)
from app.services.awards import AWARD_DEFINITIONS, AWARD_LABELS, award_rankings

router = APIRouter()

# How many recent results the form guide shows.
FORM_LENGTH = 5
# A one-match wonder should not win a discipline award.
MIN_AWARD_APPEARANCES = 3


def outcome(scored: int, conceded: int) -> str:
    if scored > conceded:
        return "W"
    return "D" if scored == conceded else "L"


async def _teams_by_ids(session: SessionDep, team_ids: set[str]) -> dict[str, Team]:
    """The teams behind a set of ids, for attributing stats to the squad they
    were earned with without a fragile join through the aggregate."""
    if not team_ids:
        return {}
    rows = (await session.scalars(select(Team).where(Team.id.in_(team_ids)))).all()
    return {team.id: team for team in rows}


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
    seasons = list((await session.scalars(
        select(Competition.season)
        .distinct()
        .join(Match, Match.competition_id == Competition.id)
        .join(PlayerMatchStat, PlayerMatchStat.match_id == Match.id)
        .where(PlayerMatchStat.player_id == player_id, Match.status == MatchStatus.finished)
        .order_by(Competition.season.desc())
    )).all())
    query = (
        select(PlayerMatchStat, Competition)
        .select_from(PlayerMatchStat)
        .join(Match, Match.id == PlayerMatchStat.match_id)
        .join(Competition, Competition.id == Match.competition_id)
        .where(PlayerMatchStat.player_id == player_id, Match.status == MatchStatus.finished)
        .order_by(Match.kickoff_datetime.desc())
    )
    if season:
        query = query.where(Competition.season == season)
    result = list((await session.execute(query)).all())
    rows = [row[0] for row in result]
    grouped: dict[str, dict[str, object]] = {}
    for stat, competition in result:
        values = grouped.setdefault(competition.id, {
            "competition": competition,
            "appearances": 0,
            "minutes_played": 0,
            "goals": 0,
            "assists": 0,
            "yellow_cards": 0,
            "red_cards": 0,
        })
        values["appearances"] += int(stat.appeared)
        for key in ("minutes_played", "goals", "assists", "yellow_cards", "red_cards"):
            values[key] += getattr(stat, key)
    competitions = [
        PlayerCompetitionSummary(
            competition_id=values["competition"].id,
            competition_name=values["competition"].name,
            season=values["competition"].season,
            appearances=values["appearances"],
            minutes_played=values["minutes_played"],
            goals=values["goals"],
            assists=values["assists"],
            yellow_cards=values["yellow_cards"],
            red_cards=values["red_cards"],
        )
        for values in grouped.values()
    ]
    return PlayerSeasonSummary(
        player=PlayerRead.model_validate(player),
        season=season,
        seasons=seasons,
        competitions=competitions,
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
    # The squad the stat was earned with — from the lineup at scoring time —
    # falling back to the player's current squad for rows that predate it. A
    # player's whole record is one row, credited to that squad rather than split.
    stat_team = func.coalesce(PlayerMatchStat.team_id, Player.team_id)
    query = (
        select(
            Player,
            func.max(stat_team).label("team_id"),
            func.sum(PlayerMatchStat.goals).label("goals"),
            func.sum(PlayerMatchStat.assists).label("assists"),
            func.sum(PlayerMatchStat.yellow_cards).label("yellow_cards"),
            func.sum(PlayerMatchStat.red_cards).label("red_cards"),
            func.sum(case((PlayerMatchStat.appeared, 1), else_=0)).label("appearances"),
        )
        .select_from(PlayerMatchStat)
        .join(Match, Match.id == PlayerMatchStat.match_id)
        .join(Player, Player.id == PlayerMatchStat.player_id)
        .where(Match.status == MatchStatus.finished)
        .group_by(Player.id)
    )
    if age_group:
        # Filtered on the earned squad, so a player is ranked in the age group
        # she turned out in, not the one she is registered with now.
        stat_team_row = aliased(Team)
        query = query.join(stat_team_row, stat_team_row.id == stat_team).where(
            stat_team_row.age_group == age_group
        )
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
    teams = await _teams_by_ids(session, {row.team_id for row in ranked})
    return [
        PlayerLeaderRow(
            rank=index,
            player=PlayerRead.model_validate(row[0]),
            team=TeamRead.model_validate(teams[row.team_id]),
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
    # Credited to the squad the stat was earned with, not the player's current
    # one; a player's whole season is one row rather than split across squads.
    stat_team = func.coalesce(PlayerMatchStat.team_id, Player.team_id)
    totals = (
        await session.execute(
            select(
                Player,
                func.max(stat_team).label("team_id"),
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
            .where(Match.status == MatchStatus.finished, Match.competition_id == competition_id)
            .group_by(Player.id)
        )
    ).all()
    teams = await _teams_by_ids(session, {row.team_id for row in totals})

    def best(label: str, value: object, unit: str, floor: int = 1) -> PlayerAward | None:
        candidates = [row for row in totals if getattr(row, value) >= floor]
        if not candidates:
            return None
        winner = max(candidates, key=lambda row: (getattr(row, value), -row.appearances))
        return PlayerAward(
            label=label,
            player=PlayerRead.model_validate(winner[0]),
            team=TeamRead.model_validate(teams[winner.team_id]),
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
                team=TeamRead.model_validate(teams[cleanest.team_id]),
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


@router.get(
    "/competitions/{competition_id}/awards/{metric}",
    response_model=list[AwardRankRow],
)
async def award_detail(
    competition_id: str,
    metric: str,
    _: CurrentUser,
    session: SessionDep,
    limit: int = 25,
) -> list[AwardRankRow]:
    """The full ranking behind one award, fetched only when a client opens it."""
    if metric not in AWARD_LABELS:
        raise api_error(404, "award_not_found", "Unknown award.")
    if await session.get(Competition, competition_id) is None:
        raise api_error(404, "competition_not_found", "Competition not found.")
    limit = max(1, min(limit, 100))
    rankings = await award_rankings(session, competition_id)
    return [
        AwardRankRow(
            rank=entry.rank,
            player=PlayerRead.model_validate(entry.player),
            team=TeamRead.model_validate(entry.team),
            value=entry.value,
            unit=entry.unit,
            appearances=entry.appearances,
        )
        for entry in rankings[metric][:limit]
    ]


@router.get("/players/{player_id}/honours", response_model=PlayerHonours)
async def player_honours(
    player_id: str, _: CurrentUser, session: SessionDep
) -> PlayerHonours:
    """Everything this player has won, worked out from the record across seasons."""
    player = await session.get(Player, player_id)
    if player is None:
        raise api_error(404, "player_not_found", "Player not found.")
    competitions = list(
        (
            await session.scalars(
                select(Competition)
                .distinct()
                .join(Match, Match.competition_id == Competition.id)
                .join(PlayerMatchStat, PlayerMatchStat.match_id == Match.id)
                .where(PlayerMatchStat.player_id == player_id)
                .order_by(Competition.season.desc(), Competition.name)
            )
        ).all()
    )
    honours: list[PlayerHonour] = []
    for competition in competitions:
        rankings = await award_rankings(session, competition.id)
        # A competition still under way says so, rather than overstating an
        # honour that could still change hands.
        remaining = (
            await session.scalar(
                select(func.count())
                .select_from(Match)
                .where(
                    Match.competition_id == competition.id,
                    Match.status != MatchStatus.finished,
                )
            )
            or 0
        )
        is_final = remaining == 0
        for metric, label, unit in AWARD_DEFINITIONS:
            ranking = rankings[metric]
            if ranking and ranking[0].player.id == player_id:
                winner = ranking[0]
                honours.append(
                    PlayerHonour(
                        competition=CompetitionRead.model_validate(competition),
                        metric=metric,
                        label=label,
                        value=winner.value,
                        unit=unit,
                        team=TeamRead.model_validate(winner.team)
                        if winner.team
                        else None,
                        is_final=is_final,
                    )
                )
    return PlayerHonours(player=PlayerRead.model_validate(player), honours=honours)


@router.get("/teams/{team_id}/squad-stats", response_model=list[SquadStatRow])
async def squad_stats(
    team_id: str, _: CurrentUser, session: SessionDep
) -> list[SquadStatRow]:
    """Every player on one squad with their season totals, zeros included.

    A player who has not featured yet still appears, at nought, because a squad
    list that hides them is not a squad. Goalkeeper figures (clean sheets, goals
    conceded) are worked out from the lineup and timeline of each finished match.
    """
    if await session.get(Team, team_id) is None:
        raise api_error(404, "team_not_found", "Team not found.")
    rows = (
        await session.execute(
            select(
                Player.id.label("player_id"),
                func.coalesce(
                    func.sum(case((PlayerMatchStat.appeared, 1), else_=0)), 0
                ).label("appearances"),
                func.coalesce(func.sum(PlayerMatchStat.minutes_played), 0).label(
                    "minutes_played"
                ),
                func.coalesce(func.sum(PlayerMatchStat.goals), 0).label("goals"),
                func.coalesce(func.sum(PlayerMatchStat.assists), 0).label("assists"),
                func.coalesce(func.sum(PlayerMatchStat.clean_sheet), 0).label(
                    "clean_sheets"
                ),
                func.coalesce(func.sum(PlayerMatchStat.goals_conceded), 0).label(
                    "goals_conceded"
                ),
            )
            .select_from(Player)
            .outerjoin(PlayerMatchStat, PlayerMatchStat.player_id == Player.id)
            .outerjoin(
                Match,
                and_(
                    Match.id == PlayerMatchStat.match_id,
                    Match.status == MatchStatus.finished,
                ),
            )
            .where(
                Player.team_id == team_id,
                or_(PlayerMatchStat.id.is_(None), Match.id.isnot(None)),
            )
            .group_by(Player.id)
            .order_by(Player.name)
        )
    ).all()
    return [
        SquadStatRow(
            player_id=row.player_id,
            appearances=row.appearances,
            minutes_played=row.minutes_played,
            goals=row.goals,
            assists=row.assists,
            clean_sheets=row.clean_sheets,
            goals_conceded=row.goals_conceded,
        )
        for row in rows
    ]
