from __future__ import annotations

import datetime as dt
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import Timestamps, UuidPk

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.place import Place
    from app.models.trip import Trip


class Stop(Base, UuidPk, Timestamps):
    """A leg of the trip — a city you sleep in, roughly."""

    __tablename__ = "stop"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), index=True
    )

    name: Mapped[str] = mapped_column(String(200))
    country_code: Mapped[str | None] = mapped_column(String(2))

    # IANA name, e.g. "Asia/Tokyo". Every booking attached to this stop
    # defaults to this zone, which is why it is required.
    tz: Mapped[str] = mapped_column(String(64))

    arrive_date: Mapped[dt.date | None] = mapped_column(Date)
    depart_date: Mapped[dt.date | None] = mapped_column(Date)

    # Explicit ordering rather than sorting by date: an itinerary is often
    # sketched before the dates are known.
    position: Mapped[int] = mapped_column(Integer, default=0)

    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text)

    trip: Mapped[Trip] = relationship(back_populates="stops")
    bookings: Mapped[list[Booking]] = relationship(back_populates="stop")
    places: Mapped[list[Place]] = relationship(back_populates="stop")

    __table_args__ = (
        CheckConstraint(
            "depart_date IS NULL OR arrive_date IS NULL OR depart_date >= arrive_date",
            name="ck_stop_date_order",
        ),
        CheckConstraint("position >= 0", name="ck_stop_position_non_negative"),
        Index("ix_stop_trip_position", "trip_id", "position"),
    )
