import datetime as dt
import uuid

from pydantic import Field

from app.schemas.common import ReadModel, WriteModel


class DayNoteWrite(WriteModel):
    """The body of a write; the day itself comes from the URL."""

    note: str = Field(min_length=1, max_length=4000)


class DayNoteRead(ReadModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    day: dt.date
    note: str
    created_at: dt.datetime
    updated_at: dt.datetime
