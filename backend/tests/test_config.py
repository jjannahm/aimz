from app.core.config import normalize_database_url


def test_normalizes_standard_postgres_url_for_asyncpg() -> None:
    result = normalize_database_url(
        "postgresql://aimz:secret@example.neon.tech/neondb"
        "?sslmode=require&channel_binding=require"
    )

    assert result == (
        "postgresql+asyncpg://aimz:secret@example.neon.tech/neondb?ssl=require"
    )


def test_preserves_local_asyncpg_url() -> None:
    value = "postgresql+asyncpg://aimz:change-me@localhost:5432/aimz"

    assert normalize_database_url(value) == value
