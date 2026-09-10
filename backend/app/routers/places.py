import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.deps import DbSession
from app.models import Place, Stop, Trip
from app.schemas.place import PlaceCreate, PlaceRead, PlaceUpdate
from app.services.lookup import apply_update, child_of_trip, get_or_404

router = APIRouter(prefix="/api/trips/{trip_id}/places", tags=["places"])


@router.get("", response_model=list[PlaceRead])
def list_places(trip_id: uuid.UUID, db: DbSession) -> list[Place]:
    get_or_404(db, Trip, trip_id)
    return list(db.scalars(select(Place).where(Place.trip_id == trip_id).order_by(Place.name)))


@router.post("", response_model=PlaceRead, status_code=status.HTTP_201_CREATED)
def create_place(trip_id: uuid.UUID, payload: PlaceCreate, db: DbSession) -> Place:
    get_or_404(db, Trip, trip_id)
    if payload.stop_id is not None:
        child_of_trip(db, Stop, payload.stop_id, trip_id)

    place = Place(trip_id=trip_id, **payload.model_dump())
    db.add(place)
    db.commit()
    return place


@router.get("/{place_id}", response_model=PlaceRead)
def read_place(trip_id: uuid.UUID, place_id: uuid.UUID, db: DbSession) -> Place:
    return child_of_trip(db, Place, place_id, trip_id)


@router.patch("/{place_id}", response_model=PlaceRead)
def update_place(
    trip_id: uuid.UUID, place_id: uuid.UUID, payload: PlaceUpdate, db: DbSession
) -> Place:
    place = child_of_trip(db, Place, place_id, trip_id)
    if "stop_id" in payload.model_fields_set and payload.stop_id is not None:
        child_of_trip(db, Stop, payload.stop_id, trip_id)

    apply_update(place, payload)
    db.commit()
    return place


@router.delete("/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_place(trip_id: uuid.UUID, place_id: uuid.UUID, db: DbSession) -> None:
    place = child_of_trip(db, Place, place_id, trip_id)
    db.delete(place)
    db.commit()
