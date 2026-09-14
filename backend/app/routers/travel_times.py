import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.deps import DbSession
from app.models import TravelTime, Trip
from app.models.travel_time import key
from app.schemas.travel_time import TravelTimeRead, TravelTimeWrite
from app.services.lookup import get_or_404

router = APIRouter(prefix="/api/trips/{trip_id}/travel-times", tags=["travel times"])


@router.put("", response_model=TravelTimeRead)
def set_travel_time(trip_id: uuid.UUID, payload: TravelTimeWrite, db: DbSession) -> TravelTime:
    """Record how long a leg really takes, replacing any earlier answer.

    PUT addressed by the pair of coordinates rather than POST returning an
    id: there is at most one correction per leg, so the client already knows
    the address and never has to ask whether one exists. Writing the same
    thing twice is harmless, which is what the offline queue needs.

    The coordinates are rounded on the way in, exactly as they are on the
    way out, or the same leg saved from two sources would never match the
    correction typed for it.
    """
    get_or_404(db, Trip, trip_id)

    from_lat, from_lon = key(payload.from_lat, payload.from_lon)
    to_lat, to_lon = key(payload.to_lat, payload.to_lon)

    existing = db.scalar(
        select(TravelTime).where(
            TravelTime.trip_id == trip_id,
            TravelTime.from_lat == from_lat,
            TravelTime.from_lon == from_lon,
            TravelTime.to_lat == to_lat,
            TravelTime.to_lon == to_lon,
        )
    )
    if existing:
        existing.minutes = payload.minutes
        db.commit()
        return existing

    created = TravelTime(
        trip_id=trip_id,
        from_lat=from_lat,
        from_lon=from_lon,
        to_lat=to_lat,
        to_lon=to_lon,
        minutes=payload.minutes,
    )
    db.add(created)
    db.commit()
    return created


@router.delete("/{travel_time_id}", status_code=status.HTTP_204_NO_CONTENT)
def forget_travel_time(trip_id: uuid.UUID, travel_time_id: uuid.UUID, db: DbSession) -> None:
    """Go back to the estimate for this leg."""
    get_or_404(db, Trip, trip_id)
    found = db.scalar(
        select(TravelTime).where(TravelTime.id == travel_time_id, TravelTime.trip_id == trip_id)
    )
    if found:
        db.delete(found)
        db.commit()
