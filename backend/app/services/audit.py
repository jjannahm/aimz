from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLog, User


def record_audit(
    session: AsyncSession,
    actor: User,
    action: str,
    entity_type: str,
    summary: str,
    entity_id: str | None = None,
    match_id: str | None = None,
) -> AuditLog:
    """Note an admin write so a match scored by two people can be untangled later.

    The actor's name is copied in rather than joined, so the trail still reads
    after the account is removed.
    """
    entry = AuditLog(
        actor_id=actor.id,
        actor_name=actor.name,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        match_id=match_id,
        summary=summary,
    )
    session.add(entry)
    return entry
