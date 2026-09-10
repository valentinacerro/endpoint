import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.deps import DbSession
from app.errors import AppError
from app.models import Booking, Expense, Stop, Trip
from app.schemas.expense import ExpenseRead, ExpenseWrite
from app.services.lookup import child_of_trip, get_or_404

router = APIRouter(prefix="/api/trips/{trip_id}/expenses", tags=["expenses"])


@router.get("", response_model=list[ExpenseRead])
def list_expenses(trip_id: uuid.UUID, db: DbSession) -> list[Expense]:
    get_or_404(db, Trip, trip_id)
    return list(
        db.scalars(
            select(Expense)
            .where(Expense.trip_id == trip_id)
            .order_by(Expense.spent_at.desc(), Expense.created_at.desc())
        )
    )


@router.put("/{expense_id}", response_model=ExpenseRead)
def put_expense(
    trip_id: uuid.UUID, expense_id: uuid.UUID, payload: ExpenseWrite, db: DbSession
) -> Expense:
    """Create or replace an expense at an id the client chose.

    PUT rather than POST on purpose. You record a coffee in a station with
    no signal; the write is queued and replayed later, possibly twice if the
    first attempt's response never came back. Addressed by a client-chosen
    id, a repeat is the same write and leaves one expense, not two.
    """
    get_or_404(db, Trip, trip_id)
    if payload.stop_id:
        child_of_trip(db, Stop, payload.stop_id, trip_id)
    if payload.booking_id:
        child_of_trip(db, Booking, payload.booking_id, trip_id)

    existing = db.get(Expense, expense_id)
    if existing is not None:
        if existing.trip_id != trip_id:
            raise AppError(
                "expense_not_found", "That expense belongs to another trip", status_code=404
            )
        for field, value in payload.model_dump().items():
            setattr(existing, field, value)
        db.commit()
        return existing

    expense = Expense(id=expense_id, trip_id=trip_id, **payload.model_dump())
    db.add(expense)
    db.commit()
    return expense


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(trip_id: uuid.UUID, expense_id: uuid.UUID, db: DbSession) -> None:
    expense = child_of_trip(db, Expense, expense_id, trip_id)
    db.delete(expense)
    db.commit()
