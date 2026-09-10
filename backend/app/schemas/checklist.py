import datetime as dt
import uuid

from pydantic import Field

from app.enums import ChecklistCategory
from app.schemas.common import ReadModel, ShortText, WriteModel


class ChecklistItemWrite(WriteModel):
    """The body of a write; the id comes from the URL.

    Addressed by an id the client chooses, like expenses and for the same
    reason: ticking things off happens while packing, often with the phone
    on a table and the wifi flaky, so the write has to be safe to replay.
    """

    text: ShortText
    category: ChecklistCategory = ChecklistCategory.OTHER
    is_done: bool = False
    position: int = Field(default=0, ge=0)


class ChecklistItemRead(ReadModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    text: str
    category: ChecklistCategory
    is_done: bool
    position: int
    created_at: dt.datetime
    updated_at: dt.datetime
