from __future__ import annotations

import datetime as dt
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import Timestamps, UuidPk

if TYPE_CHECKING:
    from app.models.trip import Trip


class DiaryEntry(Base, UuidPk, Timestamps):
    """What you want to remember about a day, written after it.

    Deliberately not the same field as a `DayNote`, which looks the other
    way: a day note is planning written beforehand — "closed on Mondays",
    "buy the JR Pass at the station" — and you delete it once it has done
    its job. A diary entry is the thing you would be sorry to lose. Sharing
    one column would mean clearing a spent reminder also wiped the memory
    of the day it reminded you about.

    Keyed by a `DATE` for the same reason as a day note: which day you are
    writing about is a calendar question. Writing at two in the morning
    still belongs to the evening you are describing, and an instant would
    quietly file it under tomorrow.
    """

    __tablename__ = "diary_entry"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), index=True
    )
    day: Mapped[dt.date] = mapped_column(Date)
    text: Mapped[str] = mapped_column(Text)

    trip: Mapped[Trip] = relationship(back_populates="diary")

    __table_args__ = (
        # One entry per day, which is what lets the API address it by date
        # and treat a write as an upsert. That is also what makes it safe to
        # replay from the offline queue — and this is a write that happens
        # offline more often than not, in a hotel room at the end of a day.
        UniqueConstraint("trip_id", "day", name="uq_diary_entry_trip_day"),
    )
