import asyncio
import sys

from sqlalchemy import Text, select, type_coerce, update

from app.core.config import (
    KNOWN_PLACEHOLDER_PASSWORDS,
    is_default_invite_code,
    is_placeholder_password,
    settings,
)
from app.core.field_crypto import encryption_configured, is_sealed
from app.core.security import hash_password, secret_hash, verify_password
from app.db.models import NewcomerApplication, RegistrationInvite, User, UserRole
from app.db.session import AsyncSessionFactory, engine


async def seed() -> None:
    if settings.hosted and is_placeholder_password(settings.admin_password):
        # The template's placeholder is printed in this repository. An admin
        # seeded with it is an open door, so nothing is seeded until it changes.
        print(
            "Refusing to seed: ADMIN_PASSWORD is still the published placeholder. "
            "Run infra/aws-cdk/scripts/set-admin-password.sh first.",
            file=sys.stderr,
        )
        raise SystemExit(1)
    async with AsyncSessionFactory() as session:
        admin = await session.scalar(
            select(User).where(User.email == str(settings.admin_email).lower())
        )
        if admin is None:
            admin = User(
                name=settings.admin_name,
                email=str(settings.admin_email).lower(),
                hashed_password=hash_password(settings.admin_password),
                role=UserRole.admin,
            )
            session.add(admin)
            await session.flush()
        elif any(verify_password(value, admin.hashed_password) for value in _placeholders()):
            # An earlier seed ran before the secret was changed. Seeding never
            # touched an existing admin, so setting the secret alone could not
            # close that door; this does, once, from the password now configured.
            admin.hashed_password = hash_password(settings.admin_password)
            print("Replaced the seeded admin's placeholder password.")

        if settings.review_email and settings.review_password:
            review = await session.scalar(
                select(User).where(User.email == str(settings.review_email).lower())
            )
            if review is None:
                session.add(
                    User(
                        name=settings.review_name or "App Review",
                        email=str(settings.review_email).lower(),
                        hashed_password=hash_password(settings.review_password),
                        role=UserRole.admin,
                    )
                )

        if settings.hosted and is_default_invite_code(settings.initial_invite_code):
            # Published in this repository, so it would let anybody register.
            # Invitations for a hosted academy are made in the app instead.
            print("Skipped the initial invitation: INITIAL_INVITE_CODE is the published example.")
        else:
            invite = await session.scalar(
                select(RegistrationInvite).where(
                    RegistrationInvite.code_hash == secret_hash(settings.initial_invite_code)
                )
            )
            if invite is None:
                session.add(
                    RegistrationInvite(
                        label="Initial academy access",
                        code_hash=secret_hash(settings.initial_invite_code),
                        created_by_id=admin.id,
                    )
                )
        await session.commit()
    await engine.dispose()
    print(f"Seed complete. Admin account: {settings.admin_email}")


def _placeholders() -> list[str]:
    # Both cases: the CDK template writes its placeholder in capitals.
    upper = {value.upper() for value in KNOWN_PLACEHOLDER_PASSWORDS}
    return sorted(KNOWN_PLACEHOLDER_PASSWORDS | upper)


async def seal_health_data(batch: int = 500) -> int:
    """Seal health notes written before a DATA_ENCRYPTION_KEY was configured.

    Read past the column type, so a row still in plaintext is seen as it is, and
    written back through it, which seals. Safe to run again: sealed rows are
    skipped. Run after the first deploy that sets the key, and after importing a
    D1 export whose rows predate the Worker's key.
    """
    if not encryption_configured():
        print("DATA_ENCRYPTION_KEY is not set; nothing sealed.", file=sys.stderr)
        return 0
    raw_concerns = type_coerce(NewcomerApplication.medical_concerns, Text)
    raw_medications = type_coerce(NewcomerApplication.medications, Text)
    sealed = 0
    async with AsyncSessionFactory() as session:
        rows = (
            await session.execute(
                select(NewcomerApplication.id, raw_concerns, raw_medications)
                .where(
                    ~raw_concerns.startswith("enc:v1:") | ~raw_medications.startswith("enc:v1:")
                )
                .limit(batch)
            )
        ).all()
        for row_id, concerns, medications in rows:
            await session.execute(
                update(NewcomerApplication)
                .where(NewcomerApplication.id == row_id)
                .values(
                    medical_concerns=concerns,
                    medications=medications,
                    # Sealing is not an edit; the queue keeps its order.
                    updated_at=NewcomerApplication.updated_at,
                )
            )
            sealed += int(not (is_sealed(concerns) and is_sealed(medications)))
        await session.commit()
    await engine.dispose()
    print(f"Sealed health notes on {sealed} applications.")
    return sealed


def main() -> None:
    asyncio.run(seed())


def seal_main() -> None:
    asyncio.run(seal_health_data())


if __name__ == "__main__":
    main()
