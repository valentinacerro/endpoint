import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.deps import DbSession
from app.errors import AppError
from app.models import Memory, Trip
from app.schemas.memory import MemoryRead, MemoryWrite
from app.services.lookup import child_of_trip, get_or_404

router = APIRouter(prefix="/api/trips/{trip_id}/memories", tags=["memories"])


@router.get("", response_model=list[MemoryRead])
def list_memories(trip_id: uuid.UUID, db: DbSession) -> list[Memory]:
    get_or_404(db, Trip, trip_id)
    return list(
        db.scalars(select(Memory).where(Memory.trip_id == trip_id).order_by(Memory.taken_at))
    )


@router.put("/{memory_id}", response_model=MemoryRead)
def put_memory(
    trip_id: uuid.UUID, memory_id: uuid.UUID, payload: MemoryWrite, db: DbSession
) -> Memory:
    """Create or replace one point, at an id the client chose.

    The id is derived from the photograph, so re-importing is a no-op
    rather than a second copy of your holiday.
    """
    get_or_404(db, Trip, trip_id)

    existing = db.get(Memory, memory_id)
    if existing is not None:
        if existing.trip_id != trip_id:
            raise AppError(
                "memory_not_found", "That memory belongs to another trip", status_code=404
            )
        for field, value in payload.model_dump().items():
            setattr(existing, field, value)
        db.commit()
        return existing

    memory = Memory(id=memory_id, trip_id=trip_id, **payload.model_dump())
    db.add(memory)
    db.commit()
    return memory


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory(trip_id: uuid.UUID, memory_id: uuid.UUID, db: DbSession) -> None:
    memory = child_of_trip(db, Memory, memory_id, trip_id)
    db.delete(memory)
    db.commit()
