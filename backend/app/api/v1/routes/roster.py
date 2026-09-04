from fastapi import APIRouter
from sqlalchemy import delete, select

from app.api.deps import AdminUser, SessionDep
from app.core.errors import api_error
from app.db.models import Player, PlayerContact
from app.schemas import PlayerContactRead, RosterInput, RosterRead

router = APIRouter()


async def _load_player(session: SessionDep, player_id: str) -> Player:
    player = await session.get(Player, player_id)
    if player is None:
        raise api_error(404, "player_not_found", "Player not found.")
    return player


async def _roster(session: SessionDep, player: Player) -> RosterRead:
    contacts = (
        await session.scalars(
            select(PlayerContact)
            .where(PlayerContact.player_id == player.id)
            .order_by(PlayerContact.name)
        )
    ).all()
    return RosterRead(
        player_id=player.id,
        date_of_birth=player.date_of_birth,
        contacts=[PlayerContactRead.model_validate(row) for row in contacts],
    )


@router.get("/players/{player_id}/contacts", response_model=RosterRead)
async def get_roster(player_id: str, _: AdminUser, session: SessionDep) -> RosterRead:
    return await _roster(session, await _load_player(session, player_id))


@router.put("/players/{player_id}/contacts", response_model=RosterRead)
async def replace_roster(
    player_id: str, payload: RosterInput, _: AdminUser, session: SessionDep
) -> RosterRead:
    player = await _load_player(session, player_id)
    player.date_of_birth = payload.date_of_birth
    # The contact list is replaced wholesale, mirroring the Worker's PUT.
    await session.execute(
        delete(PlayerContact).where(PlayerContact.player_id == player_id)
    )
    session.add_all(
        PlayerContact(
            player_id=player_id,
            name=contact.name,
            relationship=contact.relationship,
            email=contact.email,
            phone=contact.phone,
        )
        for contact in payload.contacts
    )
    await session.commit()
    return await _roster(session, player)
