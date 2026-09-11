import datetime as dt
import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.deps import DbSession
from app.errors import AppError
from app.models import DiaryEntry, Trip
from app.schemas.diary import DiaryEntryRead, DiaryEntryWrite
from app.services.lookup import get_or_404

router = APIRouter(prefix="/api/trips/{trip_id}/diary", tags=["diary"])


def _find(db: DbSession, trip_id: uuid.UUID, day: dt.date) -> DiaryEntry | None:
    return db.scalar(select(DiaryEntry).where(DiaryEntry.trip_id == trip_id, DiaryEntry.day == day))


@router.get("", response_model=list[DiaryEntryRead])
def list_entries(trip_id: uuid.UUID, db: DbSession) -> list[DiaryEntry]:
    get_or_404(db, Trip, trip_id)
    return list(
        db.scalars(select(DiaryEntry).where(DiaryEntry.trip_id == trip_id).order_by(DiaryEntry.day))
    )


@router.put("/{day}", response_model=DiaryEntryRead)
def set_entry(
    trip_id: uuid.UUID, day: dt.date, payload: DiaryEntryWrite, db: DbSession
) -> DiaryEntry:
    """Write the entry for a day, creating it if it is not there yet.

    Addressed by date rather than by an id the server hands out, which is
    what makes a replayed write leave one entry instead of two. It matters
    more here than anywhere else: this is written at the end of a day, in
    a hotel room, on whatever the wifi happens to be doing.
    """
    get_or_404(db, Trip, trip_id)

    existing = _find(db, trip_id, day)
    if existing:
        existing.text = payload.text
        db.commit()
        return existing

    entry = DiaryEntry(trip_id=trip_id, day=day, text=payload.text)
    db.add(entry)
    db.commit()
    return entry


@router.delete("/{day}", status_code=status.HTTP_204_NO_CONTENT)
def clear_entry(trip_id: uuid.UUID, day: dt.date, db: DbSession) -> None:
    get_or_404(db, Trip, trip_id)
    existing = _find(db, trip_id, day)
    if existing is None:
        raise AppError("diary_entry_not_found", "Nothing written on that day", status_code=404)
    db.delete(existing)
    db.commit()
