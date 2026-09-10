import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.deps import DbSession
from app.errors import AppError
from app.models import ChecklistItem, Trip
from app.schemas.checklist import ChecklistItemRead, ChecklistItemWrite
from app.services.lookup import child_of_trip, get_or_404

router = APIRouter(prefix="/api/trips/{trip_id}/checklist", tags=["checklist"])


@router.get("", response_model=list[ChecklistItemRead])
def list_items(trip_id: uuid.UUID, db: DbSession) -> list[ChecklistItem]:
    get_or_404(db, Trip, trip_id)
    return list(
        db.scalars(
            select(ChecklistItem)
            .where(ChecklistItem.trip_id == trip_id)
            .order_by(ChecklistItem.position, ChecklistItem.created_at)
        )
    )


@router.put("/{item_id}", response_model=ChecklistItemRead)
def put_item(
    trip_id: uuid.UUID, item_id: uuid.UUID, payload: ChecklistItemWrite, db: DbSession
) -> ChecklistItem:
    """Create or replace one line at an id the client chose.

    Ticking a box offline queues this write; replaying it must leave the
    box ticked once, not add a second copy of the line.
    """
    get_or_404(db, Trip, trip_id)

    existing = db.get(ChecklistItem, item_id)
    if existing is not None:
        if existing.trip_id != trip_id:
            raise AppError(
                "checklist_item_not_found",
                "That item belongs to another trip",
                status_code=404,
            )
        for field, value in payload.model_dump().items():
            setattr(existing, field, value)
        db.commit()
        return existing

    item = ChecklistItem(id=item_id, trip_id=trip_id, **payload.model_dump())
    db.add(item)
    db.commit()
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(trip_id: uuid.UUID, item_id: uuid.UUID, db: DbSession) -> None:
    item = child_of_trip(db, ChecklistItem, item_id, trip_id)
    db.delete(item)
    db.commit()
