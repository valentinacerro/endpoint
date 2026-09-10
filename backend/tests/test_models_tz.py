"""Timezone handling — the highest-consequence logic in the backend.

The failure mode here is not ugly, it is dangerous: a flight shown an hour
early, or a day boundary that slides "Day 3" onto "Day 2". Every test in this
module runs twice, once with the server clock in Rome and once in Tokyo,
because the most common way to get this wrong is to accidentally depend on the
machine's local time — which passes silently on a laptop in Italy and breaks on
a server in Virginia.
"""

import datetime as dt
import time
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.exc import StatementError
from sqlalchemy.orm import Session

from app.enums import BookingKind
from app.models import Booking, Trip
from tests.factories import make_booking, make_trip

TOKYO = ZoneInfo("Asia/Tokyo")
ROME = ZoneInfo("Europe/Rome")


@pytest.fixture(params=["Europe/Rome", "Asia/Tokyo"], autouse=True)
def server_timezone(request):
    """Run every test in this module under two different server clocks."""
    import os

    previous = os.environ.get("TZ")
    os.environ["TZ"] = request.param
    time.tzset()
    try:
        yield request.param
    finally:
        if previous is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = previous
        time.tzset()


def test_the_instant_survives_a_round_trip(db_session: Session) -> None:
    trip = make_trip(db_session)
    departure = dt.datetime(2026, 4, 12, 15, 0, tzinfo=TOKYO)

    booking = make_booking(
        db_session,
        trip,
        kind=BookingKind.FLIGHT,
        title="NH 204",
        start_at=departure,
        start_tz="Asia/Tokyo",
    )
    db_session.expire_all()

    stored = db_session.get(Booking, booking.id)
    assert stored is not None
    # Same moment in time, whatever the server clock says.
    assert stored.start_at == departure
    # And it comes back as UTC, aware, never naive.
    assert stored.start_at.tzinfo is not None
    assert stored.start_at.utcoffset() == dt.timedelta(0)
    assert stored.start_at.hour == 6  # 15:00 in Tokyo is 06:00 UTC


def test_the_wall_clock_is_recoverable_because_the_zone_is_stored(db_session: Session) -> None:
    """The whole reason `start_tz` exists.

    Knowing the instant is not enough: the app has to show "15:00" while you
    are still planning from Italy, not "08:00".
    """
    trip = make_trip(db_session)
    booking = make_booking(
        db_session,
        trip,
        kind=BookingKind.HOTEL,
        start_at=dt.datetime(2026, 4, 12, 15, 0, tzinfo=TOKYO),
        start_tz="Asia/Tokyo",
    )
    db_session.expire_all()

    stored = db_session.get(Booking, booking.id)
    assert stored is not None
    local = stored.start_at.astimezone(ZoneInfo(stored.start_tz))
    assert (local.hour, local.minute) == (15, 0)


def test_start_and_end_can_live_in_different_zones(db_session: Session) -> None:
    """A Rome to Tokyo flight: one shared zone could not render both ends."""
    trip = make_trip(db_session)
    booking = make_booking(
        db_session,
        trip,
        kind=BookingKind.FLIGHT,
        title="Rome to Tokyo",
        start_at=dt.datetime(2026, 4, 11, 14, 0, tzinfo=ROME),
        start_tz="Europe/Rome",
        end_at=dt.datetime(2026, 4, 12, 9, 35, tzinfo=TOKYO),
        end_tz="Asia/Tokyo",
    )
    db_session.expire_all()

    stored = db_session.get(Booking, booking.id)
    assert stored is not None
    departure = stored.start_at.astimezone(ZoneInfo(stored.start_tz))
    arrival = stored.end_at.astimezone(ZoneInfo(stored.end_tz))

    assert (departure.hour, departure.minute) == (14, 0)
    assert (arrival.hour, arrival.minute) == (9, 35)
    # Departs on the 11th local, lands on the 12th local — the date changes.
    assert departure.date() == dt.date(2026, 4, 11)
    assert arrival.date() == dt.date(2026, 4, 12)


def test_a_naive_datetime_is_refused(db_session: Session) -> None:
    """Refusing beats guessing: 15:00 in which city?"""
    trip = make_trip(db_session)
    booking = Booking(
        trip_id=trip.id,
        kind=BookingKind.HOTEL,
        title="Ambiguous",
        start_at=dt.datetime(2026, 4, 12, 15, 0),  # no tzinfo
        start_tz="Asia/Tokyo",
    )
    db_session.add(booking)
    # SQLAlchemy wraps the type's own error, so assert on the cause rather than
    # on the wrapper.
    with pytest.raises(StatementError) as raised:
        db_session.flush()
    assert isinstance(raised.value.orig, ValueError)
    assert "naive datetime" in str(raised.value.orig)


def test_dates_without_a_time_do_not_shift(db_session: Session) -> None:
    """A trip starts on a day, not at an instant.

    Storing a date as midnight UTC is the classic off-by-one that makes a trip
    appear to begin the day before when read from Tokyo.
    """
    start = dt.date(2026, 4, 11)
    end = dt.date(2026, 4, 25)
    trip = make_trip(db_session, start_date=start, end_date=end)
    db_session.expire_all()

    stored = db_session.get(Trip, trip.id)
    assert stored is not None
    assert stored.start_date == start
    assert stored.end_date == end
    assert isinstance(stored.start_date, dt.date)
    assert not isinstance(stored.start_date, dt.datetime)


def test_ordering_by_instant_is_independent_of_the_server_clock(db_session: Session) -> None:
    trip = make_trip(db_session)
    make_booking(
        db_session,
        trip,
        title="second",
        start_at=dt.datetime(2026, 4, 12, 9, 0, tzinfo=TOKYO),
        start_tz="Asia/Tokyo",
    )
    make_booking(
        db_session,
        trip,
        title="first",
        start_at=dt.datetime(2026, 4, 12, 0, 30, tzinfo=ROME),  # 07:30 in Tokyo
        start_tz="Europe/Rome",
    )
    db_session.expire_all()

    titles = list(
        db_session.scalars(
            select(Booking.title).where(Booking.trip_id == trip.id).order_by(Booking.start_at)
        )
    )
    assert titles == ["first", "second"]
