"""The season lifecycle guard, ported from the Worker's requireOpenSeason /
requireOpenCompetition.

A completed season keeps everything it had — its table, results, statistics and
bracket — but stops accepting anything new. Every write that assumes a season is
still being played is turned away here rather than left to alter a season that
has been signed off.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import api_error
from app.db.models import Competition, CompetitionStatus, Match


def require_open_competition(competition: Competition) -> None:
    """Refuse a change to a season that has ended."""
    if competition.status == CompetitionStatus.completed:
        raise api_error(
            409,
            "season_completed",
            f"{competition.name} {competition.season} has ended. "
            "Reopen the season before changing it.",
        )


async def require_open_season(session: AsyncSession, match: Match) -> None:
    """Refuse scoring a match whose season has ended, read from the match."""
    competition = await session.scalar(
        select(Competition).where(Competition.id == match.competition_id)
    )
    if competition is not None:
        require_open_competition(competition)
