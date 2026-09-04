from fastapi import APIRouter, Response, status
from sqlalchemy import delete, select

from app.api.deps import CurrentUser, SessionDep
from app.db.models import Player, Team, User, UserRole
from app.schemas import ChildRead, ChildrenResponse, UserRead, UserUpdate
from app.services.team_access import linked_player_ids

router = APIRouter()


@router.get("/me", response_model=UserRead)
async def me(current_user: CurrentUser) -> User:
    return current_user


@router.get("/me/children", response_model=ChildrenResponse)
async def my_children(current_user: CurrentUser, session: SessionDep) -> ChildrenResponse:
    """The roster players this account speaks for. A parent answers with each
    child; a player answers with the one player it is, so a caller has a single
    shape either way. An administrator speaks for no roster player, so answers
    with an empty list rather than the missing-link error a linked account gets.
    """
    if current_user.role == UserRole.admin:
        return ChildrenResponse(items=[])
    player_ids = await linked_player_ids(session, current_user)
    rows = (
        await session.execute(
            select(Player.id, Player.name, Player.team_id, Team.name)
            .outerjoin(Team, Team.id == Player.team_id)
            .where(Player.id.in_(player_ids))
            .order_by(Player.name)
        )
    ).all()
    return ChildrenResponse(
        items=[
            ChildRead(id=pid, name=name, team_id=team_id, team_name=team_name)
            for pid, name, team_id, team_name in rows
        ]
    )


@router.patch("/me", response_model=UserRead)
async def update_me(payload: UserUpdate, current_user: CurrentUser, session: SessionDep) -> User:
    current_user.name = payload.name.strip()
    await session.commit()
    await session.refresh(current_user)
    return current_user


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(current_user: CurrentUser, session: SessionDep) -> Response:
    await session.execute(delete(User).where(User.id == current_user.id))
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
