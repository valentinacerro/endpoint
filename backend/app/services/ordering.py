"""Keeping the stops of a trip in a clean 0..n-1 sequence."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import Stop


def next_position(db: Session, trip_id: uuid.UUID) -> int:
    """Append at the end."""
    highest = db.scalar(select(func.max(Stop.position)).where(Stop.trip_id == trip_id))
    return 0 if highest is None else highest + 1


def reorder(db: Session, trip_id: uuid.UUID, stop_ids: list[uuid.UUID]) -> list[Stop]:
    """Rewrite the whole order from a complete list of ids.

    The client sends every stop, not "move this one to index 3". That makes
    the operation idempotent and makes gaps and duplicates impossible to
    express — whereas a move-based API has to be defended against both.
    """
    stops = list(db.scalars(select(Stop).where(Stop.trip_id == trip_id)))
    by_id = {stop.id: stop for stop in stops}

    if len(stop_ids) != len(set(stop_ids)):
        raise AppError("duplicate_stop_ids", "The same stop appears twice", field="stop_ids")
    if set(stop_ids) != set(by_id):
        raise AppError(
            "stop_set_mismatch",
            "The list must contain every stop of the trip, exactly once",
            field="stop_ids",
        )

    for index, stop_id in enumerate(stop_ids):
        by_id[stop_id].position = index
    db.flush()
    return [by_id[stop_id] for stop_id in stop_ids]
