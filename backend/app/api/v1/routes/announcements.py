from fastapi import APIRouter, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import AdminUser, CurrentUser, SessionDep
from app.core.errors import api_error
from app.db.models import Announcement
from app.schemas import (
    AnnouncementInput,
    AnnouncementRead,
    AnnouncementUpdate,
    Page,
    TeamRead,
)
from app.services.team_access import require_aimz_team, scoped_teams

router = APIRouter()

_LOAD = (selectinload(Announcement.author), selectinload(Announcement.team))


def _page_args(limit: int, offset: int) -> tuple[int, int]:
    return min(max(limit, 1), 100), max(offset, 0)


def _serialize(row: Announcement) -> AnnouncementRead:
    return AnnouncementRead(
        id=row.id,
        team_id=row.team_id,
        title=row.title,
        body=row.body,
        author_id=row.author_id,
        pinned=row.pinned,
        created_at=row.created_at,
        updated_at=row.updated_at,
        author_name=row.author.name if row.author else None,
        team=TeamRead.model_validate(row.team) if row.team else None,
    )


async def _reload(session: SessionDep, announcement_id: str) -> Announcement:
    row = await session.scalar(
        select(Announcement).where(Announcement.id == announcement_id).options(*_LOAD)
    )
    assert row is not None
    return row


@router.get("/announcements", response_model=Page[AnnouncementRead])
async def list_announcements(
    current_user: CurrentUser,
    session: SessionDep,
    team_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> Page[AnnouncementRead]:
    team_ids = await scoped_teams(session, current_user, team_id)
    limit, offset = _page_args(limit, offset)
    query = select(Announcement).options(*_LOAD)
    count_query = select(func.count()).select_from(Announcement)
    # Academy-wide notices (no team) reach everyone; otherwise the caller only
    # sees notices for squads they may open.
    if team_ids is not None:
        scope = or_(Announcement.team_id.in_(team_ids), Announcement.team_id.is_(None))
        query, count_query = query.where(scope), count_query.where(scope)
    total = await session.scalar(count_query) or 0
    rows = (
        await session.scalars(
            query.order_by(
                Announcement.pinned.desc(), Announcement.created_at.desc()
            )
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Page(
        items=[_serialize(row) for row in rows], total=total, limit=limit, offset=offset
    )


@router.post("/announcements", response_model=AnnouncementRead, status_code=201)
async def create_announcement(
    payload: AnnouncementInput, actor: AdminUser, session: SessionDep
) -> AnnouncementRead:
    if payload.team_id:
        await require_aimz_team(session, payload.team_id)
    row = Announcement(
        team_id=payload.team_id,
        title=payload.title,
        body=payload.body,
        author_id=actor.id,
        pinned=payload.pinned,
    )
    session.add(row)
    await session.commit()
    return _serialize(await _reload(session, row.id))


@router.patch("/announcements/{announcement_id}", response_model=AnnouncementRead)
async def update_announcement(
    announcement_id: str,
    payload: AnnouncementUpdate,
    _: AdminUser,
    session: SessionDep,
) -> AnnouncementRead:
    row = await session.get(Announcement, announcement_id)
    if row is None:
        raise api_error(404, "announcement_not_found", "Announcement not found.")
    provided = payload.model_fields_set
    if "team_id" in provided:
        if payload.team_id:
            await require_aimz_team(session, payload.team_id)
        row.team_id = payload.team_id
    if "title" in provided and payload.title is not None:
        row.title = payload.title
    if "body" in provided and payload.body is not None:
        row.body = payload.body
    if "pinned" in provided and payload.pinned is not None:
        row.pinned = payload.pinned
    await session.commit()
    return _serialize(await _reload(session, row.id))


@router.delete("/announcements/{announcement_id}", status_code=204)
async def delete_announcement(
    announcement_id: str, _: AdminUser, session: SessionDep
) -> Response:
    row = await session.get(Announcement, announcement_id)
    if row is None:
        raise api_error(404, "announcement_not_found", "Announcement not found.")
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)
