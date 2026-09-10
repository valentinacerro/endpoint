import datetime as dt
import uuid
from decimal import Decimal
from typing import Self

from pydantic import Field, model_validator

from app.enums import ExpenseCategory, PaymentMethod, RateSource
from app.schemas.common import CurrencyCode, ReadModel, ShortText, WriteModel


class ExpenseWrite(WriteModel):
    """The body of a write; the id comes from the URL.

    Addressed by an id the client chooses, so writing the same expense twice
    stores it once. That is what lets a queued write be replayed after a
    tunnel without wondering whether the first attempt got through.
    """

    description: ShortText
    amount: Decimal = Field(ge=0, decimal_places=2, max_digits=12)
    currency: CurrencyCode
    spent_at: dt.date
    category: ExpenseCategory = ExpenseCategory.OTHER
    payment_method: PaymentMethod = PaymentMethod.CARD

    stop_id: uuid.UUID | None = None
    booking_id: uuid.UUID | None = None

    rate: Decimal | None = Field(default=None, gt=0, decimal_places=8, max_digits=18)
    rate_date: dt.date | None = None
    rate_source: RateSource | None = None

    notes: str | None = None

    @model_validator(mode="after")
    def _a_rate_needs_its_provenance(self) -> Self:
        if self.rate is not None and (self.rate_date is None or self.rate_source is None):
            raise ValueError("rate_date and rate_source are required when rate is set")
        return self


class ExpenseRead(ReadModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    stop_id: uuid.UUID | None
    booking_id: uuid.UUID | None
    category: ExpenseCategory
    description: str
    amount: Decimal
    currency: str
    rate: Decimal | None
    rate_date: dt.date | None
    rate_source: RateSource | None
    spent_at: dt.date
    payment_method: PaymentMethod
    notes: str | None
    created_at: dt.datetime
    updated_at: dt.datetime
