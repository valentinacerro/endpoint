"""Fetching a row, or failing with a clear code."""

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import Base
from app.errors import AppError
from app.models import (
    Booking,
    ChecklistItem,
    DiaryEntry,
    Expense,
    Memory,
    Place,
    Stop,
    Trip,
)

_NOT_FOUND_CODES = {
    Trip: "trip_not_found",
    Stop: "stop_not_found",
    Booking: "booking_not_found",
    Place: "place_not_found",
    Expense: "expense_not_found",
    ChecklistItem: "checklist_item_not_found",
    DiaryEntry: "diary_entry_not_found",
    Memory: "memory_not_found",
}


def get_or_404[T: Base](db: Session, model: type[T], row_id: uuid.UUID) -> T:
    row = db.get(model, row_id)
    if row is None:
        code = _NOT_FOUND_CODES.get(model, "not_found")
        raise AppError(code, f"{model.__name__} not found", status_code=404)
    return row


def child_of_trip[T: Base](db: Session, model: type[T], row_id: uuid.UUID, trip_id: uuid.UUID) -> T:
    """Fetch a row and confirm it belongs to the trip in the URL.

    Without this check, `/api/trips/<A>/bookings/<B>` would happily act on a
    booking from a different trip. With a single user that is a consistency
    bug rather than a security hole, but it is exactly the kind of thing that
    becomes a security hole the day the app gains a second user.
    """
    row = get_or_404(db, model, row_id)
    if getattr(row, "trip_id", None) != trip_id:
        code = _NOT_FOUND_CODES.get(model, "not_found")
        raise AppError(code, f"{model.__name__} not found on this trip", status_code=404)
    return row


def apply_update(row: Base, payload: BaseModel) -> None:
    """Copy only the fields the client actually sent.

    `exclude_unset` is the whole point: an absent field means "leave it
    alone", while a field explicitly set to null means "clear it". Using
    `exclude_none` instead would make it impossible to ever clear a value.
    """
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)


def free_or_owned[T: Base](
    db: Session, model: type[T], row_id: uuid.UUID, trip_id: uuid.UUID
) -> T | None:
    """The row at a client-chosen id, or None when that id is free to take.

    The lookup behind every create-or-replace PUT. The client picks the id
    before the write leaves the phone, so the same write can sit in the
    offline queue, be sent, lose its reply in a tunnel and be sent again
    without producing two of anything.

    The trip check is the half that is easy to leave out. Without it a
    replay aimed at the wrong trip would quietly move a row between trips,
    because a primary key is global while the URL is not.
    """
    existing = db.get(model, row_id)
    if existing is None:
        return None
    if getattr(existing, "trip_id", None) != trip_id:
        code = _NOT_FOUND_CODES.get(model, "not_found")
        raise AppError(code, "That id belongs to another trip", status_code=404)
    return existing
