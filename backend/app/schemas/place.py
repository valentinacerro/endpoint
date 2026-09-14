import datetime as dt
import re
import uuid
from typing import Any, Self

from pydantic import AwareDatetime, Field, field_validator, model_validator

from app.enums import PlaceCategory, Priority, WeatherExposure, default_exposure
from app.schemas.common import ReadModel, ShortText, TimeZoneName, WriteModel

_WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def validate_opening_hours(value: dict[str, Any]) -> dict[str, Any]:
    """Check the shape of the opening-hours dictionary.

        {"mon": [["09:00", "17:00"]], "tue": [], "wed": [["09:00", "12:00"],
         ["13:00", "17:00"]]}

    An empty list means closed that day. A missing weekday means *unknown*,
    which the optimiser must treat as "do not assume it is open" rather than
    as "open all day" — those two readings differ by a wasted trip across
    Tokyo.
    """
    for day, ranges in value.items():
        if day not in _WEEKDAYS:
            raise ValueError(f"unknown weekday {day!r}, expected one of {', '.join(_WEEKDAYS)}")
        if not isinstance(ranges, list):
            raise ValueError(f"{day}: expected a list of [open, close] pairs")
        for entry in ranges:
            if not isinstance(entry, list | tuple) or len(entry) != 2:
                raise ValueError(f"{day}: every entry must be a pair [open, close]")
            opens, closes = entry
            for moment in (opens, closes):
                if not isinstance(moment, str) or not _TIME.match(moment):
                    raise ValueError(f"{day}: {moment!r} is not a HH:MM time")
            if closes <= opens:
                raise ValueError(f"{day}: {closes} is not after {opens}")
    return value


class PlaceCreate(WriteModel):
    name: ShortText
    category: PlaceCategory = PlaceCategory.SIGHT
    priority: Priority = Priority.NORMAL
    # Left unset, it is derived from the category — a museum is indoors, a
    # park is not — so the form stays short and the rain re-balancer still
    # has something to work with.
    weather_exposure: WeatherExposure | None = None
    stop_id: uuid.UUID | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    address: str | None = None
    url: str | None = None
    description: str | None = None
    image_url: str | None = None
    notes: str | None = None
    visit_minutes: int = Field(default=60, gt=0, le=24 * 60)
    planned_start_at: AwareDatetime | None = None
    planned_tz: TimeZoneName | None = None
    opening_hours: dict[str, Any] = Field(default_factory=dict)

    @field_validator("opening_hours")
    @classmethod
    def _hours(cls, value: dict[str, Any]) -> dict[str, Any]:
        return validate_opening_hours(value)

    @model_validator(mode="after")
    def _coordinates_come_in_pairs(self) -> Self:
        if (self.lat is None) != (self.lon is None):
            raise ValueError("lat and lon must be given together")
        return self

    @model_validator(mode="after")
    def _fill_exposure_from_category(self) -> Self:
        if self.weather_exposure is None:
            self.weather_exposure = default_exposure(self.category)
        return self

    @model_validator(mode="after")
    def _planned_time_needs_a_zone(self) -> Self:
        if self.planned_start_at is not None and not self.planned_tz:
            raise ValueError("planned_tz is required when planned_start_at is set")
        return self


class PlaceUpdate(WriteModel):
    name: ShortText | None = None
    category: PlaceCategory | None = None
    priority: Priority | None = None
    # No derivation here: changing the category must not silently overwrite an
    # exposure the user set on purpose.
    weather_exposure: WeatherExposure | None = None
    stop_id: uuid.UUID | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    address: str | None = None
    url: str | None = None
    description: str | None = None
    image_url: str | None = None
    notes: str | None = None
    visit_minutes: int | None = Field(default=None, gt=0, le=24 * 60)
    planned_start_at: AwareDatetime | None = None
    planned_tz: TimeZoneName | None = None
    opening_hours: dict[str, Any] | None = None

    @field_validator("opening_hours")
    @classmethod
    def _hours(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return None if value is None else validate_opening_hours(value)


class PlaceRead(ReadModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    stop_id: uuid.UUID | None
    name: str
    category: PlaceCategory
    priority: Priority
    weather_exposure: WeatherExposure
    lat: float | None
    lon: float | None
    address: str | None
    url: str | None
    description: str | None
    image_url: str | None
    notes: str | None
    visit_minutes: int
    planned_start_at: dt.datetime | None
    planned_tz: str | None
    opening_hours: dict[str, Any]
    created_at: dt.datetime
    updated_at: dt.datetime
