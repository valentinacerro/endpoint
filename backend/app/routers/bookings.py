import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.deps import DbSession
from app.errors import AppError
from app.models import Booking, Stop, Trip
from app.schemas.booking import (
    BookingCreate,
    BookingRead,
    BookingUpdate,
    validate_time_fields,
)
from app.services.lookup import apply_update, child_of_trip, get_or_404

router = APIRouter(prefix="/api/trips/{trip_id}/bookings", tags=["bookings"])


def _check_stop_belongs_to_trip(db: DbSession, stop_id: uuid.UUID | None, trip_id: uuid.UUID):
    if stop_id is not None:
        child_of_trip(db, Stop, stop_id, trip_id)


def _check_times(booking: Booking) -> None:
    """Validate the merged result, not the payload.

    A PATCH that sends only `end_at` is perfectly valid when `end_tz` is
    already stored, so the rules have to be applied to the booking as it will
    be saved.
    """
    try:
        validate_time_fields(
            start_at=booking.start_at,
            start_tz=booking.start_tz,
            end_at=booking.end_at,
            end_tz=booking.end_tz,
        )
    except ValueError as exc:
        raise AppError(
            "invalid_time_fields",
            str(exc),
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        ) from exc


@router.get("", response_model=list[BookingRead])
def list_bookings(trip_id: uuid.UUID, db: DbSession) -> list[Booking]:
    get_or_404(db, Trip, trip_id)
    return list(
        db.scalars(
            select(Booking)
            .where(Booking.trip_id == trip_id)
            .order_by(Booking.start_at.is_(None), Booking.start_at, Booking.title)
        )
    )


@router.post("", response_model=BookingRead, status_code=status.HTTP_201_CREATED)
def create_booking(trip_id: uuid.UUID, payload: BookingCreate, db: DbSession) -> Booking:
    get_or_404(db, Trip, trip_id)
    _check_stop_belongs_to_trip(db, payload.stop_id, trip_id)

    booking = Booking(trip_id=trip_id, **payload.model_dump())
    db.add(booking)
    db.commit()
    return booking


@router.get("/{booking_id}", response_model=BookingRead)
def read_booking(trip_id: uuid.UUID, booking_id: uuid.UUID, db: DbSession) -> Booking:
    return child_of_trip(db, Booking, booking_id, trip_id)


@router.patch("/{booking_id}", response_model=BookingRead)
def update_booking(
    trip_id: uuid.UUID, booking_id: uuid.UUID, payload: BookingUpdate, db: DbSession
) -> Booking:
    booking = child_of_trip(db, Booking, booking_id, trip_id)
    if "stop_id" in payload.model_fields_set:
        _check_stop_belongs_to_trip(db, payload.stop_id, trip_id)

    apply_update(booking, payload)
    _check_times(booking)
    db.commit()
    return booking


@router.delete("/{booking_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_booking(trip_id: uuid.UUID, booking_id: uuid.UUID, db: DbSession) -> None:
    booking = child_of_trip(db, Booking, booking_id, trip_id)
    db.delete(booking)
    db.commit()
