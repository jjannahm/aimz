from functools import lru_cache

from pydantic import AnyHttpUrl, EmailStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


def normalize_database_url(value: str) -> str:
    """Convert provider-style Postgres URLs into an asyncpg-compatible URL."""
    if value.startswith("postgres://"):
        value = value.replace("postgres://", "postgresql://", 1)
    if value.startswith("postgresql://"):
        value = value.replace("postgresql://", "postgresql+asyncpg://", 1)

    url = make_url(value)
    query = dict(url.query)
    ssl_mode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    if ssl_mode and ssl_mode != "disable":
        query["ssl"] = "require"
    return url.set(query=query).render_as_string(hide_password=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "AIMZ Egypt API"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "postgresql+asyncpg://aimz:change-me@localhost:5432/aimz"
    backend_cors_origins: list[AnyHttpUrl] = [
        AnyHttpUrl("http://localhost:8081"),
        AnyHttpUrl("http://localhost:19006"),
    ]
    sql_echo: bool = False
    db_pool_size: int = 3
    db_max_overflow: int = 2
    db_pool_timeout_seconds: int = 30
    jwt_secret: str = "replace-with-at-least-32-random-characters"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    password_reset_minutes: int = 15
    admin_name: str = "AIMZ Admin"
    admin_email: EmailStr = "admin@aimz.example"
    admin_password: str = "change-this-admin-password"
    review_name: str | None = None
    review_email: str | None = None
    review_password: str | None = None
    initial_invite_code: str = "AIMZ-PLAY"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: EmailStr = "scores@aimz.example"
    smtp_start_tls: bool = True
    s3_endpoint_url: str | None = None
    s3_region: str = "auto"
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_bucket: str | None = None
    s3_presign_seconds: int = 900
    media_max_bytes: int = 5_242_880
    media_enabled: bool = True

    @model_validator(mode="after")
    def normalize_and_validate(self) -> "Settings":
        self.database_url = normalize_database_url(self.database_url)
        if self.environment in {"staging", "production"}:
            if (
                len(self.jwt_secret) < 32
                or self.jwt_secret == "replace-with-at-least-32-random-characters"
            ):
                raise ValueError(
                    "Hosted environments require a unique JWT_SECRET of at least 32 characters."
                )
            if self.admin_password == "change-this-admin-password":
                raise ValueError("Hosted environments require a unique ADMIN_PASSWORD.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
