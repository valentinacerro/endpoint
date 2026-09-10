"""Configuration read from environment variables (a .env file in development)."""

from functools import lru_cache
from typing import Literal, Self

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: Literal["dev", "prod"] = "dev"
    database_url: str = "sqlite:///./dev.db"

    # Argon2id hash of the single access password. See `python -m app.hashpw`.
    app_password_hash: str = ""
    # Signing key for session tokens.
    jwt_secret: str = ""
    session_days: int = 30

    max_upload_bytes: int = 10_000_000

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @model_validator(mode="after")
    def _require_secrets_in_prod(self) -> Self:
        """In production the app must refuse to start without valid secrets.

        A crash visible in the deploy logs is far better than a live service
        that accepts any password or signs tokens with an empty key.
        """
        if not self.is_prod:
            return self
        if len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET missing or shorter than 32 characters with ENV=prod")
        if not self.app_password_hash.startswith("$argon2"):
            raise ValueError("APP_PASSWORD_HASH missing or not an Argon2 hash with ENV=prod")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
