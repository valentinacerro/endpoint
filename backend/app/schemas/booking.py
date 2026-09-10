import datetime as dt
import uuid
from decimal import Decimal
from typing import Any, Self

from pydantic import AwareDatetime, Field, model_validator

from app.enums import BookingKind, BookingStatus, TimePrecision
from app.schemas.common import CurrencyCode, ReadModel, ShortText, TimeZoneName, WriteModel


def validate_time_fields(
    *,
    start_at: dt.datetime | None,
    start_tz: str | None,
    end_at: dt.datetime | None,
    end_tz: str | None,
) -> None:
    """The three rules that keep a booking displayable.

    Shared between create and update: an update sends only some fields, so it
    has to be checked against the *resulting* state rather than the payload,
    which is why this takes plain values instead of a model.
    """
    if start_at is not None and not start_tz:
        raise ValueError("start_tz is required when start_at is set")
    if end_at is not None and not end_tz:
        raise ValueError("end_tz is required when end_at is set")
    if start_at is not None and end_at is not None and end_at < start_at:
        raise ValueError("end_at cannot be before start_at")


class BookingCreate(WriteModel):
    kind: BookingKind
    title: ShortText
    stop_id: uuid.UUID | None = None
    status: BookingStatus = BookingStatus.CONFIRMED

    provider: str | None = Field(default=None, max_length=120)
    confirmation_code: str | None = Field(default=None, max_length=120)

    # AwareDatetime, not datetime: an instant without an offset is ambiguous,
    # and rejecting it here turns a would-be 500 from the column type into a
    # clear 422 naming the field.
    start_at: AwareDatetime | None = None
    start_tz: TimeZoneName | None = None
    start_precision: TimePrecision = TimePrecision.DATETIME

    end_at: AwareDatetime | None = None
    end_tz: TimeZoneName | None = None
    end_precision: TimePrecision = TimePrecision.DATETIME

    origin_label: str | None = Field(default=None, max_length=200)
    destination_label: str | None = Field(default=None, max_length=200)
    address: str | None = None
    phone: str | None = Field(default=None, max_length=40)
    url: str | None = None

    price_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2, max_digits=12)
    price_currency: CurrencyCode | None = None

    details: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None

    @model_validator(mode="after")
    def _times_are_coherent(self) -> Self:
        validate_time_fields(
            start_at=self.start_at,
            start_tz=self.start_tz,
            end_at=self.end_at,
            end_tz=self.end_tz,
        )
        return self


class BookingUpdate(WriteModel):
    kind: BookingKind | None = None
    title: ShortText | None = None
    stop_id: uuid.UUID | None = None
    status: BookingStatus | None = None

    provider: str | None = Field(default=None, max_length=120)
    confirmation_code: str | None = Field(default=None, max_length=120)

    start_at: AwareDatetime | None = None
    start_tz: TimeZoneName | None = None
    start_precision: TimePrecision | None = None

    end_at: AwareDatetime | None = None
    end_tz: TimeZoneName | None = None
    end_precision: TimePrecision | None = None

    origin_label: str | None = Field(default=None, max_length=200)
    destination_label: str | None = Field(default=None, max_length=200)
    address: str | None = None
    phone: str | None = Field(default=None, max_length=40)
    url: str | None = None

    price_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2, max_digits=12)
    price_currency: CurrencyCode | None = None

    details: dict[str, Any] | None = None
    notes: str | None = None

    # Time coherence is checked in the router, against the merged result:
    # sending only `end_at` is legitimate if `end_tz` is already stored.


class BookingRead(ReadModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    stop_id: uuid.UUID | None
    kind: BookingKind
    status: BookingStatus
    title: str
    provider: str | None
    confirmation_code: str | None
    start_at: dt.datetime | None
    start_tz: str | None
    start_precision: TimePrecision
    end_at: dt.datetime | None
    end_tz: str | None
    end_precision: TimePrecision
    origin_label: str | None
    destination_label: str | None
    address: str | None
    phone: str | None
    url: str | None
    price_amount: Decimal | None
    price_currency: str | None
    details: dict[str, Any]
    notes: str | None
    created_at: dt.datetime
    updated_at: dt.datetime
