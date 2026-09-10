import datetime as dt
import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.deps import DbSession
from app.errors import AppError
from app.models import DayNote, Trip
from app.schemas.day_note import DayNoteRead, DayNoteWrite
from app.services.lookup import get_or_404

router = APIRouter(prefix="/api/trips/{trip_id}/days", tags=["day notes"])


def _find(db: DbSession, trip_id: uuid.UUID, day: dt.date) -> DayNote | None:
    return db.scalar(select(DayNote).where(DayNote.trip_id == trip_id, DayNote.day == day))


@router.put("/{day}/note", response_model=DayNoteRead)
def set_note(trip_id: uuid.UUID, day: dt.date, payload: DayNoteWrite, db: DbSession) -> DayNote:
    """Write the note for a day, creating it if it is not there yet.

    PUT addressed by date rather than POST returning an id: there is at most
    one note per day, so the client already knows the address and never has
    to ask whether one exists. Writing the same thing twice is harmless,
    which is what the offline write queue in Phase 2 will need.
    """
    get_or_404(db, Trip, trip_id)

    existing = _find(db, trip_id, day)
    if existing:
        existing.note = payload.note
        db.commit()
        return existing

    note = DayNote(trip_id=trip_id, day=day, note=payload.note)
    db.add(note)
    db.commit()
    return note


@router.delete("/{day}/note", status_code=status.HTTP_204_NO_CONTENT)
def clear_note(trip_id: uuid.UUID, day: dt.date, db: DbSession) -> None:
    get_or_404(db, Trip, trip_id)
    existing = _find(db, trip_id, day)
    if existing is None:
        raise AppError("day_note_not_found", "No note on that day", status_code=404)
    db.delete(existing)
    db.commit()
