from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class imported by Alembic and all future SQLAlchemy models."""
