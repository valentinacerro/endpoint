from __future__ import annotations

import datetime as dt
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import TripStatus
from app.models.base import Timestamps, UuidPk, enum_check

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.place import Place
    from app.models.stop import Stop


class Trip(Base, UuidPk, Timestamps):
    __tablename__ = "trip"

    title: Mapped[str] = mapped_column(String(200))
    destination_label: Mapped[str | None] = mapped_column(String(200))

    # Dates without a time stay DATE. A trip does not start at an instant, it
    # starts on a day — storing it as midnight UTC is the classic off-by-one
    # that makes the trip appear to begin the day before.
    start_date: Mapped[dt.date | None] = mapped_column(Date)
    end_date: Mapped[dt.date | None] = mapped_column(Date)

    # Default timezone offered when creating bookings, and the "home" clock the
    # UI compares against.
    primary_tz: Mapped[str] = mapped_column(String(64), default="Europe/Rome")
    primary_currency: Mapped[str] = mapped_column(String(3), default="EUR")

    status: Mapped[str] = mapped_column(String(16), default=TripStatus.PLANNED)
    notes: Mapped[str | None] = mapped_column(Text)

    stops: Mapped[list[Stop]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Stop.position",
    )
    bookings: Mapped[list[Booking]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Booking.start_at",
    )
    places: Mapped[list[Place]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Place.name",
    )

    __table_args__ = (
        enum_check("status", TripStatus, "ck_trip_status"),
        CheckConstraint(
            "end_date IS NULL OR start_date IS NULL OR end_date >= start_date",
            name="ck_trip_date_order",
        ),
    )
