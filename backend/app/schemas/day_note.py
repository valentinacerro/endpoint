import datetime as dt
import uuid
from typing import Self

from pydantic import Field, model_validator

from app.enums import DayTheme
from app.schemas.common import ReadModel, WriteModel


class DayNoteWrite(WriteModel):
    """The body of a write; the day itself comes from the URL.

    A whole-object write, so a day with a theme and no note sends an empty
    one. That is what keeps setting a theme from wiping a note written
    ten minutes earlier, and the client has both in hand anyway.
    """

    note: str = Field(default="", max_length=4000)
    theme: DayTheme | None = None

    @model_validator(mode="after")
    def _it_has_to_say_something(self) -> Self:
        """A row with neither is a blank that renders as a gap in the day.

        Clearing is a DELETE, and it was an empty note that used to be
        refused here. A theme is now the other thing this row can carry,
        so the rule is about the row and not about the note.
        """
        if not self.note.strip() and self.theme is None:
            raise ValueError("a day needs a note or a theme")
        return self


class DayNoteRead(ReadModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    day: dt.date
    note: str
    theme: DayTheme | None
    created_at: dt.datetime
    updated_at: dt.datetime
