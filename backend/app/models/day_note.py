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


class DayNote(Base, UuidPk, Timestamps):
    """What you have said about one day of a trip.

    "Giornata libera", "comprare il JR Pass alla stazione", "chiuso il
    lunedì" — the things that belong to a day rather than to any booking on
    it, and that would otherwise end up buried in the notes of an unrelated
    hotel.

    Keyed by a `DATE`, not by an instant: which day a note belongs to is a
    calendar question, and giving it a timezone would only invite the day to
    shift underneath it.
    """

    __tablename__ = "day_note"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), index=True
    )
    day: Mapped[dt.date] = mapped_column(Date)
    note: Mapped[str] = mapped_column(Text, default="")
    #: What kind of day you want this to be, if you have said.
    #:
    #: Here rather than in a table of its own: a note and a theme are both
    #: things you have said about one day, they are addressed the same way
    #: — by date, one per day — and two tables keyed identically is a join
    #: nobody wanted.
    theme: Mapped[str | None] = mapped_column(Text)

    trip: Mapped[Trip] = relationship(back_populates="day_notes")

    __table_args__ = (
        # One note per day, which is what lets the API address it by date and
        # treat writing as an upsert rather than needing an id.
        UniqueConstraint("trip_id", "day", name="uq_day_note_trip_day"),
    )
