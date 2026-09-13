"""Squad visibility rules, ported from the Worker's team-access helper.

An administrator may open any squad; anyone else is held to the squad(s) their
linked roster player(s) belong to. A player account speaks for the one roster
record on ``users.player_id``; a parent speaks for every child on
``user_children`` — which is why these return lists, not the single id they
started as.
"""

from fastapi import HTTPException
from sqlalchemy import ColumnElement, false, or_, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import api_error
from app.db.models import Match, Player, Team, TeamStaff, User, UserChild, UserRole

NO_LINK = "Ask an AIMZ administrator to link your account to a squad player."

# The squads an account may see, or None for an administrator, who may see all.
TeamScope = list[str] | None


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


async def team_scope(session: AsyncSession, user: User) -> TeamScope:
    """The squads an account may see: None for an administrator, its own otherwise.

    Loud: an account not linked to anything yet is refused, which is right for a
    resource asked for by id.
    """
    if user.role == UserRole.admin:
        return None
    return await linked_team_ids(session, user)


async def quiet_team_scope(session: AsyncSession, user: User) -> TeamScope:
    """The same scope, but empty rather than refused for an unlinked account.

    For lists: an account waiting to be linked gets the app's own empty states
    rather than a 403 on its opening screen.
    """
    try:
        return await team_scope(session, user)
    except HTTPException:
        return []


def match_scope_clause(scope: TeamScope) -> ColumnElement[bool] | None:
    """Whether a match is visible: one of its two teams is the caller's.

    One rule for every kind of fixture, the Worker's rule, so the two backends
    answer the same question the same way. None means unrestricted.
    """
    if scope is None:
        return None
    if not scope:
        return false()
    return or_(Match.home_team_id.in_(scope), Match.away_team_id.in_(scope))


async def visible_competition_ids(session: AsyncSession, scope: list[str]) -> list[str]:
    """The competitions a scope may see: the ones its squads are entered in, plus
    any their fixtures belong to — a friendly has no entrants, only fixtures."""
    if not scope:
        return []
    entered = select(Team.competition_id.label("id")).where(
        Team.id.in_(scope), Team.competition_id.is_not(None)
    )
    played = select(Match.competition_id.label("id")).where(match_scope_clause(scope))
    return [row for row in (await session.scalars(union(entered, played))).all() if row]


async def assert_team_visible(session: AsyncSession, user: User, team_id: str) -> None:
    """Refuse a team outside the caller's squads, unless their squad has met it.

    404 rather than 403, so the reply cannot confirm another squad's team exists.
    """
    scope = await team_scope(session, user)
    if scope is None or team_id in scope:
        return
    met = await session.scalar(
        select(Match.id)
        .where(
            match_scope_clause(scope),
            or_(Match.home_team_id == team_id, Match.away_team_id == team_id),
        )
        .limit(1)
    )
    if met is None:
        raise api_error(404, "team_not_found", "Team not found.")


async def assert_match_visible(session: AsyncSession, user: User, match_id: str) -> None:
    scope = await team_scope(session, user)
    if scope is None:
        return
    visible = await session.scalar(
        select(Match.id).where(Match.id == match_id, match_scope_clause(scope)).limit(1)
    )
    if visible is None:
        raise api_error(404, "match_not_found", "Match not found.")


async def assert_player_visible(session: AsyncSession, user: User, player_id: str) -> None:
    scope = await team_scope(session, user)
    if scope is None:
        return
    visible = await session.scalar(
        select(Player.id).where(Player.id == player_id, Player.team_id.in_(scope)).limit(1)
    )
    if visible is None:
        raise api_error(404, "player_not_found", "Player not found.")


async def assert_competition_visible(
    session: AsyncSession, user: User, competition_id: str
) -> None:
    scope = await team_scope(session, user)
    if scope is None:
        return
    if competition_id not in await visible_competition_ids(session, scope):
        raise api_error(404, "competition_not_found", "Competition not found.")


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
