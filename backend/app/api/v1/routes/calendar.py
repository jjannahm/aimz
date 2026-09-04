import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, Response
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, SessionDep
from app.core.errors import api_error
from app.db.models import (
    CalendarToken,
    Match,
    Player,
    TrainingSession,
    User,
    UserRole,
)
from app.schemas import CalendarFeedRead
from app.services.ics import build_calendar
from app.services.team_access import linked_player_ids, linked_team_ids

router = APIRouter()

# Far enough ahead to cover a season; a day behind so a live match still shows.
_WINDOW_AHEAD = timedelta(days=365)
_WINDOW_BEHIND = timedelta(days=1)

_ADMIN_MESSAGE = (
    "A calendar feed follows your own squad's fixtures. "
    "An admin account is not on a roster."
)


def _feed_url(request: Request, token: str) -> str:
    origin = str(request.base_url).rstrip("/")
    return f"{origin}/api/v1/calendar/{token}/aimz.ics"


def _refuse_admin(user: User) -> None:
    if user.role == UserRole.admin:
        raise api_error(403, "player_link_required", _ADMIN_MESSAGE)


async def _issue_token(session: SessionDep, user: User) -> str:
    """Mint a feed token, replacing any current one — which is how revoking works."""
    token = secrets.token_urlsafe(32)
    existing = await session.get(CalendarToken, user.id)
    if existing is None:
        session.add(CalendarToken(user_id=user.id, token=token))
    else:
        existing.token = token
        existing.created_at = datetime.now(UTC)
        existing.first_fetched_at = None
    await session.commit()
    return token


@router.get("/calendar/{token}/aimz.ics")
async def calendar_feed(token: str, session: SessionDep) -> Response:
    # Deliberately unauthenticated: a calendar client cannot send a bearer token,
    # so the secret in the path is the whole credential. One 404 for a wrong
    # token, a revoked one, or a deleted account, so the feed reveals nothing.
    row = await session.scalar(
        select(CalendarToken).where(CalendarToken.token == token)
    )
    if row is None:
        raise api_error(404, "not_found", "No calendar feed matches this address.")
    user = await session.scalar(
        select(User).where(User.id == row.user_id, User.is_active.is_(True))
    )
    if user is None:
        raise api_error(404, "not_found", "No calendar feed matches this address.")

    team_ids = await linked_team_ids(session, user)
    now = datetime.now(UTC)
    window_from, window_to = now - _WINDOW_BEHIND, now + _WINDOW_AHEAD

    matches = (
        await session.scalars(
            select(Match)
            .where(
                or_(
                    Match.home_team_id.in_(team_ids),
                    Match.away_team_id.in_(team_ids),
                ),
                Match.kickoff_datetime >= window_from,
                Match.kickoff_datetime <= window_to,
            )
            .options(
                selectinload(Match.home_team),
                selectinload(Match.away_team),
                selectinload(Match.competition),
            )
            .order_by(Match.kickoff_datetime)
        )
    ).all()
    sessions = (
        await session.scalars(
            select(TrainingSession)
            .where(
                TrainingSession.team_id.in_(team_ids),
                TrainingSession.starts_at >= window_from,
                TrainingSession.starts_at <= window_to,
            )
            .options(selectinload(TrainingSession.team))
            .order_by(TrainingSession.starts_at)
        )
    ).all()

    # Stamped once: a subscribed client polls hourly, and we only need to know
    # whether anyone ever added it.
    if row.first_fetched_at is None:
        row.first_fetched_at = now
        await session.commit()

    player_ids = await linked_player_ids(session, user)
    names = list(
        (
            await session.scalars(
                select(Player.name)
                .where(Player.id.in_(player_ids))
                .order_by(Player.name)
            )
        ).all()
    )
    title = f"AIMZ · {', '.join(names)}" if names else "AIMZ Egypt"
    body = build_calendar(title, list(matches), list(sessions))
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'inline; filename="aimz.ics"',
            "Cache-Control": "private, no-cache",
        },
    )


@router.get("/users/me/calendar", response_model=CalendarFeedRead)
async def get_calendar(
    request: Request, current_user: CurrentUser, session: SessionDep
) -> CalendarFeedRead:
    _refuse_admin(current_user)
    existing = await session.get(CalendarToken, current_user.id)
    return CalendarFeedRead(
        url=_feed_url(request, existing.token) if existing else None,
        subscribed_at=existing.first_fetched_at if existing else None,
    )


@router.post("/users/me/calendar", response_model=CalendarFeedRead)
async def create_calendar(
    request: Request,
    response: Response,
    current_user: CurrentUser,
    session: SessionDep,
) -> CalendarFeedRead:
    # Idempotent: pressing the calendar button twice hands back the same address
    # rather than quietly revoking the one already added to a calendar.
    _refuse_admin(current_user)
    existing = await session.get(CalendarToken, current_user.id)
    if existing is not None:
        return CalendarFeedRead(
            url=_feed_url(request, existing.token),
            subscribed_at=existing.first_fetched_at,
        )
    token = await _issue_token(session, current_user)
    response.status_code = 201
    return CalendarFeedRead(url=_feed_url(request, token), subscribed_at=None)


@router.post("/users/me/calendar/regenerate", response_model=CalendarFeedRead)
async def regenerate_calendar(
    request: Request, current_user: CurrentUser, session: SessionDep
) -> CalendarFeedRead:
    _refuse_admin(current_user)
    token = await _issue_token(session, current_user)
    return CalendarFeedRead(url=_feed_url(request, token), subscribed_at=None)


@router.delete("/users/me/calendar", status_code=204)
async def delete_calendar(
    current_user: CurrentUser, session: SessionDep
) -> Response:
    # Removing a feed that is not there is still a success.
    _refuse_admin(current_user)
    existing = await session.get(CalendarToken, current_user.id)
    if existing is not None:
        await session.delete(existing)
        await session.commit()
    return Response(status_code=204)
