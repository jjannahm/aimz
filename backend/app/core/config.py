from functools import lru_cache

from pydantic import AnyHttpUrl, EmailStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

# Values published in this repository — the CDK secret template, docker-compose
# and the examples. Anybody can read them, so a hosted environment must never
# accept one as a password or an invitation code.
KNOWN_PLACEHOLDER_PASSWORDS = frozenset(
    {
        "change-this-admin-password",
        "change-me-after-deploy",
        "change-me",
        "change-this-review-password",
    }
)
KNOWN_DEFAULT_INVITE_CODES = frozenset({"AIMZPLAY"})


def is_placeholder_password(value: str) -> bool:
    return value.strip().lower() in KNOWN_PLACEHOLDER_PASSWORDS


def is_default_invite_code(value: str) -> bool:
    return "".join(char for char in value.upper() if char.isalnum()) in KNOWN_DEFAULT_INVITE_CODES


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
        AnyHttpUrl("https://aimz-egypt-staging.pages.dev"),
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
    require_player_application: bool = False
    public_web_origin: str = "https://aimz-egypt-staging.pages.dev"
    turnstile_secret: str | None = None
    turnstile_hostnames: list[str] = ["aimz-egypt-staging.pages.dev"]
    # Seals health notes at rest (app/core/field_crypto.py). At least 32 random
    # characters; the same value as the Worker's, so imported rows still open.
    data_encryption_key: str | None = None
    # How many proxies in front of the API append the address they received to
    # X-Forwarded-For: 2 behind CloudFront and the ALB, 1 behind the ALB alone.
    # 0 trusts only the socket peer, which is right when nothing sits in front.
    trusted_proxy_hops: int = 0

    @property
    def hosted(self) -> bool:
        return self.environment in {"staging", "production"}

    @model_validator(mode="after")
    def normalize_and_validate(self) -> "Settings":
        self.database_url = normalize_database_url(self.database_url)
        if self.hosted:
            if (
                len(self.jwt_secret) < 32
                or self.jwt_secret == "replace-with-at-least-32-random-characters"
            ):
                raise ValueError(
                    "Hosted environments require a unique JWT_SECRET of at least 32 characters."
                )
            if self.admin_password == "change-this-admin-password":
                raise ValueError("Hosted environments require a unique ADMIN_PASSWORD.")
        if self.environment == "production":
            if not self.data_encryption_key or len(self.data_encryption_key) < 32:
                raise ValueError(
                    "Production requires a DATA_ENCRYPTION_KEY of at least 32 characters."
                )
            # A page on a developer's machine has no business calling production
            # with somebody's session, whatever the default list says.
            self.backend_cors_origins = [
                origin
                for origin in self.backend_cors_origins
                if origin.host not in {"localhost", "127.0.0.1"}
            ]
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
