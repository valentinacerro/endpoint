import datetime as dt
import uuid

from pydantic import Field

from app.schemas.common import ReadModel, WriteModel


class DiaryEntryWrite(WriteModel):
    """The body of a write; the day itself comes from the URL.

    Generous with length where a day note is not: this is the one field in
    the app someone might genuinely write five hundred words into.
    """

    text: str = Field(min_length=1, max_length=20_000)


class DiaryEntryRead(ReadModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    day: dt.date
    text: str
    created_at: dt.datetime
    updated_at: dt.datetime
