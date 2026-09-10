import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.deps import DbSession
from app.errors import AppError
from app.models import Stop, Trip
from app.schemas.stop import StopCreate, StopRead, StopReorder, StopUpdate
from app.services import ordering
from app.services.lookup import apply_update, child_of_trip, get_or_404

router = APIRouter(prefix="/api/trips/{trip_id}/stops", tags=["stops"])


@router.get("", response_model=list[StopRead])
def list_stops(trip_id: uuid.UUID, db: DbSession) -> list[Stop]:
    get_or_404(db, Trip, trip_id)
    return list(db.scalars(select(Stop).where(Stop.trip_id == trip_id).order_by(Stop.position)))


@router.post("", response_model=StopRead, status_code=status.HTTP_201_CREATED)
def create_stop(trip_id: uuid.UUID, payload: StopCreate, db: DbSession) -> Stop:
    get_or_404(db, Trip, trip_id)
    stop = Stop(
        trip_id=trip_id,
        position=ordering.next_position(db, trip_id),
        **payload.model_dump(),
    )
    db.add(stop)
    db.commit()
    return stop


# Declared before "/{stop_id}" so that "reorder" is never parsed as an id.
@router.post("/reorder", response_model=list[StopRead])
def reorder_stops(trip_id: uuid.UUID, payload: StopReorder, db: DbSession) -> list[Stop]:
    get_or_404(db, Trip, trip_id)
    stops = ordering.reorder(db, trip_id, payload.stop_ids)
    db.commit()
    return stops


@router.patch("/{stop_id}", response_model=StopRead)
def update_stop(trip_id: uuid.UUID, stop_id: uuid.UUID, payload: StopUpdate, db: DbSession) -> Stop:
    stop = child_of_trip(db, Stop, stop_id, trip_id)
    apply_update(stop, payload)

    if stop.arrive_date and stop.depart_date and stop.depart_date < stop.arrive_date:
        raise AppError(
            "invalid_date_range",
            "depart_date cannot be before arrive_date",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            field="depart_date",
        )

    db.commit()
    return stop


@router.delete("/{stop_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stop(trip_id: uuid.UUID, stop_id: uuid.UUID, db: DbSession) -> None:
    stop = child_of_trip(db, Stop, stop_id, trip_id)
    db.delete(stop)
    db.flush()
    # Removing a stop would otherwise leave a hole in the sequence
    # (0, 1, 3, 4), which the reorder endpoint then refuses to accept.
    remaining = list(
        db.scalars(select(Stop).where(Stop.trip_id == trip_id).order_by(Stop.position))
    )
    ordering.reorder(db, trip_id, [item.id for item in remaining])
    db.commit()
