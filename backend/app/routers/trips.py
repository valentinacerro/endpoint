import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.deps import DbSession
from app.errors import AppError
from app.models import Trip
from app.schemas.trip import TripCreate, TripRead, TripUpdate
from app.services.lookup import apply_update, get_or_404

router = APIRouter(prefix="/api/trips", tags=["trips"])


@router.get("", response_model=list[TripRead])
def list_trips(db: DbSession) -> list[Trip]:
    return list(db.scalars(select(Trip).order_by(Trip.start_date.is_(None), Trip.start_date)))


@router.post("", response_model=TripRead, status_code=status.HTTP_201_CREATED)
def create_trip(payload: TripCreate, db: DbSession) -> Trip:
    trip = Trip(**payload.model_dump())
    db.add(trip)
    db.commit()
    return trip


@router.get("/{trip_id}", response_model=TripRead)
def read_trip(trip_id: uuid.UUID, db: DbSession) -> Trip:
    return get_or_404(db, Trip, trip_id)


@router.patch("/{trip_id}", response_model=TripRead)
def update_trip(trip_id: uuid.UUID, payload: TripUpdate, db: DbSession) -> Trip:
    trip = get_or_404(db, Trip, trip_id)
    apply_update(trip, payload)

    # Checked after merging rather than on the payload: sending only
    # `end_date` is legitimate when `start_date` is already stored.
    if trip.start_date and trip.end_date and trip.end_date < trip.start_date:
        raise AppError(
            "invalid_date_range",
            "end_date cannot be before start_date",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            field="end_date",
        )

    db.commit()
    return trip


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip(trip_id: uuid.UUID, db: DbSession) -> None:
    trip = get_or_404(db, Trip, trip_id)
    db.delete(trip)
    db.commit()
