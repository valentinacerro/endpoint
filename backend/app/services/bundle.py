"""Assembling the whole trip into one response.

This is the keystone of the offline design. The phone fetches this once, keeps
it in IndexedDB and renders every read screen from it — so after a single
successful sync the entire app works in airplane mode with no per-screen
offline code.
"""

import datetime as dt
import hashlib
import uuid

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session

from app.models import Attachment, Booking, ChecklistItem, DayNote, Expense, Place, Stop, Trip
from app.schemas.bundle import TripBundle


def attachments_of_trip(trip_id: uuid.UUID) -> ColumnElement[bool]:
    """Every document reachable from the trip.

    An attachment hangs off exactly one owner, and that owner may be the trip,
    one of its stops, or one of its bookings — so filtering on `trip_id` alone
    would quietly omit every hotel voucher.
    """
    return or_(
        Attachment.trip_id == trip_id,
        Attachment.stop_id.in_(select(Stop.id).where(Stop.trip_id == trip_id)),
        Attachment.booking_id.in_(select(Booking.id).where(Booking.trip_id == trip_id)),
    )


def compute_etag(db: Session, trip: Trip) -> str:
    """A strong ETag over everything the bundle contains.

    Built from the newest `updated_at` and the row count of each table, which
    together change on any insert, update or delete. It lets the phone
    revalidate with a single conditional request that usually costs a 304 and
    no body — which matters on hotel wifi and on a metered eSIM.
    """
    parts = [f"trip:{trip.updated_at}"]

    for model in (Stop, Booking, Place, DayNote, Expense, ChecklistItem):
        newest, count = db.execute(
            select(func.max(model.updated_at), func.count()).where(model.trip_id == trip.id)
        ).one()
        parts.append(f"{model.__tablename__}:{newest}:{count}")

    newest, count = db.execute(
        select(func.max(Attachment.updated_at), func.count())
        .select_from(Attachment)
        .where(attachments_of_trip(trip.id))
    ).one()
    parts.append(f"attachment:{newest}:{count}")

    digest = hashlib.sha256("|".join(parts).encode()).hexdigest()[:32]
    return f'"{digest}"'


def build(db: Session, trip: Trip) -> TripBundle:
    stops = list(db.scalars(select(Stop).where(Stop.trip_id == trip.id).order_by(Stop.position)))
    bookings = list(
        db.scalars(
            select(Booking)
            .where(Booking.trip_id == trip.id)
            # `is_(None)` sorts False (0) before True (1), so dated bookings
            # come first and the undated ones collect at the end. Portable,
            # unlike NULLS LAST.
            .order_by(Booking.start_at.is_(None), Booking.start_at, Booking.title)
        )
    )
    places = list(db.scalars(select(Place).where(Place.trip_id == trip.id).order_by(Place.name)))
    checklist = list(
        db.scalars(
            select(ChecklistItem)
            .where(ChecklistItem.trip_id == trip.id)
            .order_by(ChecklistItem.position)
        )
    )
    expenses = list(
        db.scalars(select(Expense).where(Expense.trip_id == trip.id).order_by(Expense.spent_at))
    )
    day_notes = list(
        db.scalars(select(DayNote).where(DayNote.trip_id == trip.id).order_by(DayNote.day))
    )
    attachments = list(
        db.scalars(
            select(Attachment).where(attachments_of_trip(trip.id)).order_by(Attachment.created_at)
        )
    )

    return TripBundle.model_validate(
        {
            "trip": trip,
            "stops": stops,
            "bookings": bookings,
            "places": places,
            "checklist": checklist,
            "expenses": expenses,
            "day_notes": day_notes,
            "attachments": attachments,
            "generated_at": dt.datetime.now(dt.UTC),
        }
    )
