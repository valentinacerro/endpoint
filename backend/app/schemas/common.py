"""Field types and base classes shared by every schema."""

from typing import Annotated
from zoneinfo import available_timezones

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

# Computed once: the set is large and building it is not free.
_IANA_ZONES = available_timezones()


def _known_timezone(value: str) -> str:
    if value not in _IANA_ZONES:
        raise ValueError(f"unknown IANA timezone: {value!r}")
    return value


TimeZoneName = Annotated[str, Field(max_length=64), AfterValidator(_known_timezone)]
"""An IANA zone such as "Asia/Tokyo", checked against the system database.

Validated here rather than in the database because a CHECK constraint cannot
know the zone list, and because a typo like "Asia/Tokio" must fail as a clear
422 at the boundary instead of silently producing unreadable times later.
"""

CurrencyCode = Annotated[
    str,
    StringConstraints(min_length=3, max_length=3, to_upper=True, pattern=r"^[A-Za-z]{3}$"),
]

CountryCode = Annotated[
    str,
    StringConstraints(min_length=2, max_length=2, to_upper=True, pattern=r"^[A-Za-z]{2}$"),
]

ShortText = Annotated[str, Field(min_length=1, max_length=200)]


class ReadModel(BaseModel):
    """Base for anything read out of the database."""

    model_config = ConfigDict(from_attributes=True)


class WriteModel(BaseModel):
    """Base for anything accepted from the client.

    `extra="forbid"` on purpose: a misspelled field should be a loud 422, not
    a value that is silently dropped and then mysteriously missing.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
