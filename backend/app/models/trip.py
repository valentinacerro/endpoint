from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import TripStatus
from app.models.base import Timestamps, UuidPk, enum_check

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.checklist import ChecklistItem
    from app.models.day_note import DayNote
    from app.models.diary import DiaryEntry
    from app.models.expense import Expense
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
    # The currency you think in, and what the budget and every total are
    # reported in — not the currency you actually spend on the ground.
    primary_currency: Mapped[str] = mapped_column(String(3), default="EUR")

    # What you intend to spend in total, in `primary_currency`. Optional: a
    # trip without a declared budget still tracks its expenses, it just has
    # nothing to compare them against.
    budget_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))

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
    expenses: Mapped[list[Expense]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Expense.spent_at",
    )
    checklist: Mapped[list[ChecklistItem]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ChecklistItem.position",
    )
    day_notes: Mapped[list[DayNote]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="DayNote.day",
    )
    diary: Mapped[list[DiaryEntry]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="DiaryEntry.day",
    )

    __table_args__ = (
        enum_check("status", TripStatus, "ck_trip_status"),
        CheckConstraint(
            "end_date IS NULL OR start_date IS NULL OR end_date >= start_date",
            name="ck_trip_date_order",
        ),
        CheckConstraint(
            "budget_amount IS NULL OR budget_amount >= 0", name="ck_trip_budget_non_negative"
        ),
    )
