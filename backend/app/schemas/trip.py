import datetime as dt
import uuid
from decimal import Decimal
from typing import Self

from pydantic import Field, model_validator

from app.enums import TripStatus
from app.schemas.common import CurrencyCode, ReadModel, ShortText, TimeZoneName, WriteModel


def _check_date_order(start: dt.date | None, end: dt.date | None) -> None:
    if start is not None and end is not None and end < start:
        raise ValueError("end_date cannot be before start_date")


class TripCreate(WriteModel):
    title: ShortText
    destination_label: str | None = Field(default=None, max_length=200)
    start_date: dt.date | None = None
    end_date: dt.date | None = None
    primary_tz: TimeZoneName = "Europe/Rome"
    primary_currency: CurrencyCode = "EUR"
    budget_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2, max_digits=12)
    status: TripStatus = TripStatus.PLANNED
    notes: str | None = None

    @model_validator(mode="after")
    def _dates_in_order(self) -> Self:
        _check_date_order(self.start_date, self.end_date)
        return self


class TripUpdate(WriteModel):
    """Every field optional.

    Applied with `exclude_unset=True`, so a field that is absent is left
    alone while a field explicitly set to null is cleared. Those are two
    different intentions and the API has to be able to tell them apart.
    """

    title: ShortText | None = None
    destination_label: str | None = Field(default=None, max_length=200)
    start_date: dt.date | None = None
    end_date: dt.date | None = None
    primary_tz: TimeZoneName | None = None
    primary_currency: CurrencyCode | None = None
    budget_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2, max_digits=12)
    status: TripStatus | None = None
    notes: str | None = None


class TripRead(ReadModel):
    id: uuid.UUID
    title: str
    destination_label: str | None
    start_date: dt.date | None
    end_date: dt.date | None
    primary_tz: str
    primary_currency: str
    budget_amount: Decimal | None
    status: TripStatus
    notes: str | None
    created_at: dt.datetime
    updated_at: dt.datetime
