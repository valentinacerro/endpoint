import datetime as dt
import uuid

from pydantic import AwareDatetime, Field

from app.enums import TimeSource
from app.schemas.common import ReadModel, WriteModel


class MemoryWrite(WriteModel):
    """The body of a write; the id comes from the URL.

    The client derives that id from the photograph itself, so importing
    the same folder twice — or the same folder on two devices — writes
    the same row twice rather than making two.
    """

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    # AwareDatetime, like a booking's: an instant with no offset is
    # ambiguous, and the database layer refuses it anyway — better a 422
    # naming the field than a 500 from three layers down.
    taken_at: AwareDatetime
    taken_tz: str = Field(min_length=1, max_length=64)
    time_source: TimeSource = TimeSource.ASSUMED
    filename: str | None = Field(default=None, max_length=255)
    caption: str | None = Field(default=None, max_length=2000)


class MemoryRead(ReadModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    lat: float
    lon: float
    # AwareDatetime, like a booking's: an instant with no offset is
    # ambiguous, and the database layer refuses it anyway — better a 422
    # naming the field than a 500 from three layers down.
    taken_at: AwareDatetime
    taken_tz: str
    time_source: TimeSource
    filename: str | None
    caption: str | None
    created_at: dt.datetime
    updated_at: dt.datetime
