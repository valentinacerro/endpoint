import datetime as dt
import uuid
from typing import Self

from pydantic import Field, model_validator

from app.schemas.common import CountryCode, ReadModel, ShortText, TimeZoneName, WriteModel


class StopCreate(WriteModel):
    name: ShortText
    tz: TimeZoneName
    country_code: CountryCode | None = None
    arrive_date: dt.date | None = None
    depart_date: dt.date | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    notes: str | None = None

    # `position` is deliberately absent: the server appends the stop at the
    # end and the client reorders through the dedicated endpoint. Letting the
    # client set it directly is how you end up with two stops at position 3.

    @model_validator(mode="after")
    def _dates_in_order(self) -> Self:
        if (
            self.arrive_date is not None
            and self.depart_date is not None
            and self.depart_date < self.arrive_date
        ):
            raise ValueError("depart_date cannot be before arrive_date")
        return self


class StopUpdate(WriteModel):
    name: ShortText | None = None
    tz: TimeZoneName | None = None
    country_code: CountryCode | None = None
    arrive_date: dt.date | None = None
    depart_date: dt.date | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    notes: str | None = None


class StopReorder(WriteModel):
    """The full list of stop ids, in the order they should appear.

    The whole list rather than a "move this one to index n" operation: it is
    idempotent, and it cannot leave gaps or duplicates behind.
    """

    stop_ids: list[uuid.UUID] = Field(min_length=1)


class StopRead(ReadModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    name: str
    country_code: str | None
    tz: str
    arrive_date: dt.date | None
    depart_date: dt.date | None
    position: int
    lat: float | None
    lon: float | None
    notes: str | None
    created_at: dt.datetime
    updated_at: dt.datetime
