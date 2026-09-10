from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import ExpenseCategory, PaymentMethod
from app.models.base import Timestamps, UuidPk, enum_check

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.stop import Stop
    from app.models.trip import Trip


class Expense(Base, UuidPk, Timestamps):
    """Money actually spent.

    ## Why the amount is stored in the currency you paid in

    Converting on the way in and keeping only euros would be the easy
    version and the wrong one. The rate the bank actually applied is not the
    reference rate, and you only learn it weeks later from a statement. So
    the amount stays as ¥980 forever, alongside the rate used and where that
    rate came from; the euro figure is derived and can be recomputed when
    the real number turns up.

    ## Why the date has no time

    A coffee happened on a day. Giving it an instant would mean giving it a
    timezone, and then a purchase at 1 a.m. in Tokyo would land on the
    previous day's total when read from Rome — a bug with no upside.
    """

    __tablename__ = "expense"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), index=True
    )
    stop_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("stop.id", ondelete="SET NULL"))
    # Links a cash expense to what it was for. A prepaid booking's own price
    # lives on the booking; this is for the taxi to it.
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("booking.id", ondelete="SET NULL")
    )

    category: Mapped[str] = mapped_column(String(16), default=ExpenseCategory.OTHER)
    description: Mapped[str] = mapped_column(String(200))

    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))

    # Null until a rate is known — which offline, at the moment of paying,
    # it usually is not.
    rate: Mapped[Decimal | None] = mapped_column(Numeric(18, 8))
    rate_date: Mapped[dt.date | None] = mapped_column(Date)
    rate_source: Mapped[str | None] = mapped_column(String(8))

    spent_at: Mapped[dt.date] = mapped_column(Date, index=True)
    payment_method: Mapped[str] = mapped_column(String(8), default=PaymentMethod.CARD)
    notes: Mapped[str | None] = mapped_column(Text)

    trip: Mapped[Trip] = relationship(back_populates="expenses")
    stop: Mapped[Stop | None] = relationship()
    booking: Mapped[Booking | None] = relationship()

    __table_args__ = (
        enum_check("category", ExpenseCategory, "ck_expense_category"),
        enum_check("payment_method", PaymentMethod, "ck_expense_payment_method"),
        CheckConstraint(
            "rate_source IS NULL OR rate_source IN ('ecb', 'manual')",
            name="ck_expense_rate_source",
        ),
        CheckConstraint("amount >= 0", name="ck_expense_amount_non_negative"),
        CheckConstraint("rate IS NULL OR rate > 0", name="ck_expense_rate_positive"),
        # A rate with no date cannot be checked or replaced later.
        CheckConstraint(
            "rate IS NULL OR (rate_date IS NOT NULL AND rate_source IS NOT NULL)",
            name="ck_expense_rate_provenance",
        ),
        Index("ix_expense_trip_date", "trip_id", "spent_at"),
    )
