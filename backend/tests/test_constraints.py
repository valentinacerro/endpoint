"""Database-level guarantees.

These constraints exist so that a bug in a route handler cannot write data
that later renders as nonsense — an arrival before its departure, a time with
no timezone, a document belonging to two things at once.
"""

import datetime as dt
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.enums import BookingKind
from app.models import Attachment, Booking, Stop, Trip
from tests.factories import make_booking, make_stop, make_trip

TOKYO = ZoneInfo("Asia/Tokyo")


def test_a_translated_label_cannot_be_stored_as_a_kind(db_session: Session) -> None:
    """The rule the previous version of this app broke.

    Only stable English keys reach the database. "Hotel" and "albergo" are
    presentation, and presentation belongs in the frontend.
    """
    trip = make_trip(db_session)
    for rejected in ("Hotel", "albergo", "HOTEL"):
        db_session.add(Booking(trip_id=trip.id, kind=rejected, title="x"))
        with pytest.raises(IntegrityError):
            db_session.flush()
        db_session.rollback()


def test_the_lowercase_key_is_accepted(db_session: Session) -> None:
    trip = make_trip(db_session)
    booking = make_booking(db_session, trip, kind=BookingKind.HOTEL)
    assert booking.kind == "hotel"


def test_an_instant_without_its_timezone_is_refused(db_session: Session) -> None:
    """Half the timezone design would be pointless if `start_tz` could be null
    while `start_at` is set: the app would have an instant it cannot display."""
    trip = make_trip(db_session)
    db_session.add(
        Booking(
            trip_id=trip.id,
            kind=BookingKind.FLIGHT,
            title="no zone",
            start_at=dt.datetime(2026, 4, 12, 15, 0, tzinfo=TOKYO),
            start_tz=None,
        )
    )
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_a_booking_cannot_end_before_it_starts(db_session: Session) -> None:
    trip = make_trip(db_session)
    db_session.add(
        Booking(
            trip_id=trip.id,
            kind=BookingKind.HOTEL,
            title="backwards",
            start_at=dt.datetime(2026, 4, 12, 15, 0, tzinfo=TOKYO),
            start_tz="Asia/Tokyo",
            end_at=dt.datetime(2026, 4, 11, 10, 0, tzinfo=TOKYO),
            end_tz="Asia/Tokyo",
        )
    )
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_a_trip_cannot_end_before_it_starts(db_session: Session) -> None:
    db_session.add(
        Trip(
            title="backwards",
            start_date=dt.date(2026, 4, 25),
            end_date=dt.date(2026, 4, 11),
        )
    )
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_an_attachment_needs_exactly_one_owner(db_session: Session) -> None:
    trip = make_trip(db_session)
    stop = make_stop(db_session, trip)

    common = {
        "filename": "voucher.pdf",
        "content_type": "application/pdf",
        "byte_size": 12,
        "sha256": "a" * 64,
    }

    # No owner: it would be unreachable and would never be cleaned up.
    db_session.add(Attachment(**common))
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    # Two owners: deleting one of them would leave a half-orphan.
    db_session.add(Attachment(trip_id=trip.id, stop_id=stop.id, **common))
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    # Exactly one is fine.
    db_session.add(Attachment(trip_id=trip.id, **common))
    db_session.flush()


def test_stop_position_cannot_be_negative(db_session: Session) -> None:
    trip = make_trip(db_session)
    db_session.add(Stop(trip_id=trip.id, name="Kyoto", tz="Asia/Tokyo", position=-1))
    with pytest.raises(IntegrityError):
        db_session.flush()
