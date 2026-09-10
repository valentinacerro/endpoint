from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import BookingKind, BookingStatus, TimePrecision
from app.models.base import Timestamps, UtcDateTime, UuidPk, enum_check

if TYPE_CHECKING:
    from app.models.attachment import Attachment
    from app.models.stop import Stop
    from app.models.trip import Trip


class Booking(Base, UuidPk, Timestamps):
    """Anything with a time and a confirmation code: hotels, flights, trains.

    ## Why one table instead of one per kind

    Six tables joined polymorphically is ceremony for a personal app. A single
    table with nullable columns plus a typed JSON escape hatch (`details`)
    means a new kind of booking usually needs no migration at all.

    ## Why times are stored twice over

    A travel event is not "an instant", it is *a wall-clock time at a place*.
    Check-in at 15:00 in Tokyo must read 15:00 whether you are in Rome in
    February or in Shinjuku in April. Store only a UTC instant and render it
    in the device's zone, and while planning from Italy that check-in shows as
    08:00 — technically correct, practically useless.

    So each end of an event carries both the instant (`*_at`, always UTC) and
    the IANA zone it should be read in (`*_tz`). Start and end have *separate*
    zones, and that is not over-engineering: a Rome to Tokyo flight leaves at
    14:00 `Europe/Rome` and lands at 09:35 `Asia/Tokyo` the next day. One
    shared zone cannot render both correctly, and getting it wrong on a
    boarding day is precisely the failure this app exists to prevent.
    """

    __tablename__ = "booking"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), index=True
    )
    # Hotels belong to a stop; flights usually sit between two of them.
    # Deleting a stop must not delete the flight that was leaving from it.
    stop_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("stop.id", ondelete="SET NULL"), index=True
    )

    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default=BookingStatus.CONFIRMED)

    title: Mapped[str] = mapped_column(String(200))
    provider: Mapped[str | None] = mapped_column(String(120))
    confirmation_code: Mapped[str | None] = mapped_column(String(120))

    start_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime)
    start_tz: Mapped[str | None] = mapped_column(String(64))
    # Lets one table hold both a 09:35 flight and a date-only "hotel, 3 nights"
    # without a parallel set of columns.
    start_precision: Mapped[str] = mapped_column(String(16), default=TimePrecision.DATETIME)

    end_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime)
    end_tz: Mapped[str | None] = mapped_column(String(64))
    end_precision: Mapped[str] = mapped_column(String(16), default=TimePrecision.DATETIME)

    origin_label: Mapped[str | None] = mapped_column(String(200))
    destination_label: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(Text)

    # Where this happens. Added now rather than later because the itinerary
    # optimiser treats bookings as the fixed points a day is built around —
    # a museum slot at 10:30 constrains everything near it — and it cannot do
    # that without knowing where they are.
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    phone: Mapped[str | None] = mapped_column(String(40))
    url: Mapped[str | None] = mapped_column(Text)

    price_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    price_currency: Mapped[str | None] = mapped_column(String(3))

    # Kind-specific fields: flight_no, terminal, gate, seat, room_type,
    # platform, car_class… MutableDict so that mutating the dict in place is
    # actually detected and saved; without it `booking.details["seat"] = "12A"`
    # would silently do nothing.
    details: Mapped[dict[str, Any]] = mapped_column(
        MutableDict.as_mutable(JSON().with_variant(JSONB, "postgresql")),
        default=dict,
    )

    notes: Mapped[str | None] = mapped_column(Text)

    trip: Mapped[Trip] = relationship(back_populates="bookings")
    stop: Mapped[Stop | None] = relationship(back_populates="bookings")
    attachments: Mapped[list[Attachment]] = relationship(
        back_populates="booking",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        enum_check("kind", BookingKind, "ck_booking_kind"),
        enum_check("status", BookingStatus, "ck_booking_status"),
        enum_check("start_precision", TimePrecision, "ck_booking_start_precision"),
        enum_check("end_precision", TimePrecision, "ck_booking_end_precision"),
        # An instant without its zone is unreadable: refuse the combination.
        CheckConstraint("start_at IS NULL OR start_tz IS NOT NULL", name="ck_booking_start_tz"),
        CheckConstraint("end_at IS NULL OR end_tz IS NOT NULL", name="ck_booking_end_tz"),
        CheckConstraint(
            "end_at IS NULL OR start_at IS NULL OR end_at >= start_at",
            name="ck_booking_time_order",
        ),
        Index("ix_booking_trip_start", "trip_id", "start_at"),
    )
