"""Season award rankings, ported from the Worker's scoring-rules AWARDS.

Awards are derived from the record rather than stored, so a cabinet is always
the truth as it stands. Every metric here is computable from the existing
``player_match_stats`` columns plus man-of-the-match on the match — none needs
goalkeeper stats.
"""

from dataclasses import dataclass

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Match, MatchStatus, Player, PlayerMatchStat, Team

# A one-match wonder should not win a discipline award.
MIN_AWARD_APPEARANCES = 3

# metric -> (label, unit). Order is the display order the Worker used.
AWARD_DEFINITIONS: list[tuple[str, str, str]] = [
    ("motm", "Most man of the match", "awards"),
    ("goals", "Top scorer", "goals"),
    ("assists", "Most assists", "assists"),
    ("appearances", "Most appearances", "appearances"),
    ("minutes", "Most minutes", "minutes"),
    ("discipline", "Best discipline", "cards"),
]
AWARD_LABELS = {metric: label for metric, label, _ in AWARD_DEFINITIONS}
AWARD_UNITS = {metric: unit for metric, _, unit in AWARD_DEFINITIONS}


@dataclass
class _Totals:
    player: Player
    team: Team
    goals: int
    assists: int
    minutes: int
    cards: int
    appearances: int
    motm: int


def _value(metric: str, row: _Totals) -> int:
    return {
        "motm": row.motm,
        "goals": row.goals,
        "assists": row.assists,
        "appearances": row.appearances,
        "minutes": row.minutes,
        "discipline": row.cards,
    }[metric]


def _eligible(metric: str, row: _Totals) -> bool:
    if metric == "discipline":
        # Fewest cards, but only among regulars: an untested nil from a player
        # who barely featured is not a clean record.
        return row.appearances >= MIN_AWARD_APPEARANCES
    return _value(metric, row) >= 1


def _sort_key(metric: str, row: _Totals) -> tuple:
    """A key that sorts best-first, with player name breaking the final tie."""
    name = row.player.name.lower()
    if metric == "discipline":
        # Fewest cards first; among equals, the one who played more.
        return (row.cards, -row.appearances, name)
    # Most of anything; the fewer matches it took, the better.
    return (-_value(metric, row), row.appearances, name)


@dataclass
class AwardRank:
    rank: int
    player: Player
    team: Team
    value: int
    unit: str
    appearances: int


async def _totals(session: AsyncSession, competition_id: str) -> list[_Totals]:
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
    # Credited to the squad the stat was earned with, from the lineup at scoring
    # time, falling back to the player's current squad for rows that predate it.
    # One row per player, so a player who changed squad keeps a single record.
    stat_team = func.coalesce(PlayerMatchStat.team_id, Player.team_id)
    rows = (
        await session.execute(
            select(
                Player,
                func.max(stat_team).label("team_id"),
                func.sum(PlayerMatchStat.goals).label("goals"),
                func.sum(PlayerMatchStat.assists).label("assists"),
                func.sum(PlayerMatchStat.minutes_played).label("minutes"),
                func.sum(
                    PlayerMatchStat.yellow_cards + PlayerMatchStat.red_cards
                ).label("cards"),
                func.sum(case((PlayerMatchStat.appeared, 1), else_=0)).label(
                    "appearances"
                ),
                motm,
            )
            .select_from(PlayerMatchStat)
            .join(Match, Match.id == PlayerMatchStat.match_id)
            .join(Player, Player.id == PlayerMatchStat.player_id)
            .where(
                Match.status == MatchStatus.finished,
                Match.competition_id == competition_id,
            )
            .group_by(Player.id)
        )
    ).all()
    team_ids = {row.team_id for row in rows}
    teams = {
        team.id: team
        for team in (
            await session.scalars(select(Team).where(Team.id.in_(team_ids)))
        ).all()
    }
    return [
        _Totals(
            player=row[0],
            team=teams[row.team_id],
            goals=row.goals or 0,
            assists=row.assists or 0,
            minutes=row.minutes or 0,
            cards=row.cards or 0,
            appearances=row.appearances or 0,
            motm=row.motm or 0,
        )
        for row in rows
    ]


async def award_rankings(
    session: AsyncSession, competition_id: str
) -> dict[str, list[AwardRank]]:
    """Every award's full ranking, so a headline winner is always rank 1."""
    totals = await _totals(session, competition_id)
    rankings: dict[str, list[AwardRank]] = {}
    for metric, _label, unit in AWARD_DEFINITIONS:
        eligible = [row for row in totals if _eligible(metric, row)]
        ordered = sorted(eligible, key=lambda row, m=metric: _sort_key(m, row))
        rankings[metric] = [
            AwardRank(
                rank=index,
                player=row.player,
                team=row.team,
                value=_value(metric, row),
                unit=unit,
                appearances=row.appearances,
            )
            for index, row in enumerate(ordered, start=1)
        ]
    return rankings
