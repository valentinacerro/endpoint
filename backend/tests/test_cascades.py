"""What disappears, and what must not, when something is deleted.

Getting this wrong is data loss in one direction and orphaned rows in the
other. Note these are enforced by the database, not by the ORM: SQLite only
honours them with `PRAGMA foreign_keys=ON`, which conftest sets — without it
this whole module would pass while proving nothing.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Attachment, AttachmentBlob, Booking, Stop
from tests.factories import make_attachment, make_booking, make_stop, make_trip


def _count(db: Session, model) -> int:
    return db.scalar(select(func.count()).select_from(model)) or 0


def test_deleting_a_trip_removes_everything_below_it(db_session: Session) -> None:
    trip = make_trip(db_session)
    stop = make_stop(db_session, trip)
    booking = make_booking(db_session, trip, stop_id=stop.id)
    make_attachment(db_session, booking_id=booking.id)
    make_attachment(db_session, trip_id=trip.id)

    assert _count(db_session, AttachmentBlob) == 2

    db_session.delete(trip)
    db_session.commit()

    assert _count(db_session, Stop) == 0
    assert _count(db_session, Booking) == 0
    assert _count(db_session, Attachment) == 0
    # The bytes must go too, otherwise the free 0.5 GB fills with ghosts.
    assert _count(db_session, AttachmentBlob) == 0


def test_deleting_a_booking_removes_its_documents(db_session: Session) -> None:
    trip = make_trip(db_session)
    booking = make_booking(db_session, trip)
    make_attachment(db_session, booking_id=booking.id)

    db_session.delete(booking)
    db_session.commit()

    assert _count(db_session, Attachment) == 0
    assert _count(db_session, AttachmentBlob) == 0


def test_deleting_a_stop_keeps_its_bookings(db_session: Session) -> None:
    """A flight is attached to the stop it departs from, but it is not part of
    it. Removing "Kyoto" from the itinerary must not delete the train ticket
    that was going there — it must only detach it."""
    trip = make_trip(db_session)
    stop = make_stop(db_session, trip)
    booking = make_booking(db_session, trip, stop_id=stop.id)

    db_session.delete(stop)
    db_session.commit()
    db_session.expire_all()

    survivor = db_session.get(Booking, booking.id)
    assert survivor is not None
    assert survivor.stop_id is None


def test_a_blob_is_never_loaded_by_accident(db_session: Session) -> None:
    """Reading a list of attachments must not pull megabytes into memory.

    The relationship is declared `lazy="raise"` precisely so that a careless
    access fails loudly here instead of quietly slowing the app down on a
    phone with a bad connection.
    """
    import pytest
    from sqlalchemy.exc import InvalidRequestError

    trip = make_trip(db_session)
    attachment = make_attachment(db_session, trip_id=trip.id)
    db_session.expire_all()

    fresh = db_session.get(Attachment, attachment.id)
    assert fresh is not None
    assert fresh.byte_size > 0  # metadata is free
    with pytest.raises(InvalidRequestError):
        _ = fresh.blob  # the bytes are not
