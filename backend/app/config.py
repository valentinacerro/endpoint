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
            raise ValueError(
                f"JWT_SECRET is {len(self.jwt_secret)} characters; at least 32 are required "
                "with ENV=prod. Generate one with `make password`."
            )
        if not self.app_password_hash.startswith("$argon2"):
            raise ValueError(
                "APP_PASSWORD_HASH must be an Argon2 hash starting with '$argon2', "
                f"but it {_describe(self.app_password_hash)}. Run `make password` and copy only "
                "the part after the first '=' — not the whole printed line."
            )
        return self


def _describe(value: str) -> str:
    """Say enough about a bad secret to diagnose it, without printing it.

    The three ways this goes wrong all look identical from the outside — the
    variable is unset, the whole `NAME=value` line was pasted into the value
    box, or a quote came along for the ride — and an error that just says
    "invalid" leaves you guessing at a deploy log. Ten characters is enough
    to tell them apart and far short of anything useful to an attacker,
    especially as this is a one-way hash to begin with.
    """
    if not value:
        return "is empty or unset"
    return f"starts with {value[:10]!r} ({len(value)} characters)"


@lru_cache
def get_settings() -> Settings:
    return Settings()
