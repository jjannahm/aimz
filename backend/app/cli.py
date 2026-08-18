import asyncio

from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password, secret_hash
from app.db.models import RegistrationInvite, User, UserRole
from app.db.session import AsyncSessionFactory, engine


async def seed() -> None:
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


def main() -> None:
    asyncio.run(seed())


if __name__ == "__main__":
    main()
