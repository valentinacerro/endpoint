"""Small builders so tests state only what they are actually about."""

import datetime as dt
import hashlib
import uuid

from sqlalchemy.orm import Session

from app.enums import BookingKind
from app.models import Attachment, AttachmentBlob, Booking, Stop, Trip


def make_trip(db: Session, **kwargs) -> Trip:
    trip = Trip(**{"title": "Japan", "primary_tz": "Asia/Tokyo", **kwargs})
    db.add(trip)
    db.commit()
    return trip


def make_stop(db: Session, trip: Trip, **kwargs) -> Stop:
    stop = Stop(**{"trip_id": trip.id, "name": "Tokyo", "tz": "Asia/Tokyo", **kwargs})
    db.add(stop)
    db.commit()
    return stop


def make_booking(db: Session, trip: Trip, **kwargs) -> Booking:
    booking = Booking(
        **{
            "trip_id": trip.id,
            "kind": BookingKind.HOTEL,
            "title": "Hotel Gracery Shinjuku",
            **kwargs,
        }
    )
    db.add(booking)
    db.commit()
    return booking


def make_attachment(db: Session, *, data: bytes = b"%PDF-1.4 fake", **owner) -> Attachment:
    attachment = Attachment(
        filename="voucher.pdf",
        content_type="application/pdf",
        byte_size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        **owner,
    )
    db.add(attachment)
    db.flush()
    db.add(AttachmentBlob(attachment_id=attachment.id, data=data))
    db.commit()
    return attachment


def utc(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> dt.datetime:
    return dt.datetime(year, month, day, hour, minute, tzinfo=dt.UTC)


def new_id() -> uuid.UUID:
    return uuid.uuid4()
