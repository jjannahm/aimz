from fastapi import APIRouter, Response, status
from sqlalchemy import delete

from app.api.deps import CurrentUser, SessionDep
from app.db.models import User
from app.schemas import UserRead, UserUpdate

router = APIRouter()


@router.get("/me", response_model=UserRead)
async def me(current_user: CurrentUser) -> User:
    return current_user


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
