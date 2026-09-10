import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import secret_hash
from app.db.models import RegistrationInvite

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def normalize_invite_code(value: str) -> str:
    return "".join(character for character in value.upper() if character.isalnum())


def display_invite_code(value: str) -> str:
    compact = normalize_invite_code(value)
    return "-".join((compact[:4], compact[4:8], compact[8:]))


async def unique_invite_code(session: AsyncSession) -> tuple[str, str]:
    for _ in range(12):
        compact = "".join(secrets.choice(ALPHABET) for _ in range(10))
        digest = secret_hash(compact)
        if (
            await session.scalar(
                select(RegistrationInvite.id).where(RegistrationInvite.code_hash == digest)
            )
            is None
        ):
            return display_invite_code(compact), digest
    raise RuntimeError("Could not allocate a unique invitation code.")


def invite_hash_candidates(value: str) -> tuple[str, ...]:
    """Accept old literal codes and new compact/hyphenated codes."""
    compact = normalize_invite_code(value)
    hashes = {secret_hash(value), secret_hash(value.upper()), secret_hash(compact)}
    return tuple(hashes)
