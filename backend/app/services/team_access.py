"""Squad visibility rules, ported from the Worker's team-access helper.

An administrator may open any squad; anyone else is held to the squad(s) their
linked roster player(s) belong to. A player account speaks for the one roster
record on ``users.player_id``; a parent speaks for every child on
``user_children`` — which is why these return lists, not the single id they
started as.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import api_error
from app.db.models import Player, Team, TeamStaff, User, UserChild, UserRole

NO_LINK = "Ask an AIMZ administrator to link your account to a squad player."


async def linked_player_ids(session: AsyncSession, user: User) -> list[str]:
    """The roster players an account speaks for: one for a player, several for a
    parent."""
    if user.role == UserRole.parent:
        player_ids = list(
            (
                await session.scalars(
                    select(UserChild.player_id).where(UserChild.user_id == user.id)
                )
            ).all()
        )
        if not player_ids:
            raise api_error(403, "player_link_required", NO_LINK)
        return player_ids
    if user.player_id is None:
        raise api_error(403, "player_link_required", NO_LINK)
    return [user.player_id]


async def linked_team_ids(session: AsyncSession, user: User) -> list[str]:
    """The squads a non-admin account speaks for. A parent with children on two
    squads gets both."""
    if user.role == UserRole.coach:
        team_ids = list(
            (
                await session.scalars(select(TeamStaff.team_id).where(TeamStaff.user_id == user.id))
            ).all()
        )
        if not team_ids:
            raise api_error(403, "team_access_denied", "No squad is assigned to this coach.")
        return team_ids
    player_ids = await linked_player_ids(session, user)
    team_ids = list(
        (
            await session.scalars(
                select(Player.team_id).where(Player.id.in_(player_ids)).distinct()
            )
        ).all()
    )
    if not team_ids:
        raise api_error(
            403,
            "player_link_required",
            "Your linked player is no longer on the roster. Ask an AIMZ administrator for help.",
        )
    return team_ids


async def scoped_teams(
    session: AsyncSession, user: User, requested: str | None
) -> list[str] | None:
    """Resolve a ``team_id`` filter to the squads the caller may actually see.

    Returns ``None`` for an administrator with no filter, meaning "all squads".
    """
    if user.role == UserRole.admin:
        return [requested] if requested else None
    team_ids = await linked_team_ids(session, user)
    if requested:
        if requested not in team_ids:
            raise api_error(
                403, "team_access_denied", "You can only open your own squad's team hub."
            )
        return [requested]
    return team_ids


async def can_open_team(session: AsyncSession, user: User, team_id: str) -> bool:
    """True when the account may open this squad; an administrator always may.

    Mirrors the Worker: an *unlinked* account raises ``player_link_required``
    (via ``linked_team_ids``) rather than quietly returning False, so the caller
    reports the missing link rather than a bare access denial.
    """
    if user.role == UserRole.admin:
        return True
    return team_id in await linked_team_ids(session, user)


async def require_aimz_team(session: AsyncSession, team_id: str) -> None:
    team = await session.scalar(select(Team).where(Team.id == team_id, Team.is_aimz.is_(True)))
    if team is None:
        raise api_error(422, "team_not_found", "Choose an AIMZ squad.")


async def require_team_operator(session: AsyncSession, user: User, team_id: str) -> None:
    """Allow an admin or a coach assigned to this exact squad."""
    await require_aimz_team(session, team_id)
    if user.role == UserRole.admin:
        return
    if user.role != UserRole.coach or team_id not in await linked_team_ids(session, user):
        raise api_error(403, "team_access_denied", "You can only operate your assigned squad.")
