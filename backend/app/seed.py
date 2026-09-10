"""Fill the development database with a realistic trip.

    make seed

Development only, and it says so: it refuses to run against ENV=prod. Real
data beats an empty screen when working on the interface — an itinerary that
crosses two time zones, a booking with no date yet, and a voucher to open are
exactly the cases that expose layout problems.
"""

import datetime as dt
import hashlib
import sys
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.enums import (
    AttachmentKind,
    BookingKind,
    BookingStatus,
    PlaceCategory,
    Priority,
    StorageBackend,
    TripStatus,
    WeatherExposure,
)
from app.models import Attachment, AttachmentBlob, Booking, DayNote, Place, Stop, Trip

TOKYO = ZoneInfo("Asia/Tokyo")
ROME = ZoneInfo("Europe/Rome")
TITLE = "Giappone 2026"

VOUCHER = b"%PDF-1.4\nHotel Gracery Shinjuku - voucher\n"


def main() -> int:
    settings = get_settings()
    if settings.is_prod:
        print("Refusing to seed a production database.", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        if db.scalar(select(Trip).where(Trip.title == TITLE)):
            print(f'"{TITLE}" is already there; nothing to do.')
            return 0

        trip = Trip(
            title=TITLE,
            destination_label="Giappone",
            start_date=dt.date(2026, 4, 11),
            end_date=dt.date(2026, 4, 18),
            primary_tz="Europe/Rome",
            primary_currency="EUR",
            budget_amount=Decimal("3200.00"),
            status=TripStatus.PLANNED,
        )
        db.add(trip)
        db.flush()

        tokyo = Stop(
            trip_id=trip.id,
            name="Tokyo",
            country_code="JP",
            tz="Asia/Tokyo",
            arrive_date=dt.date(2026, 4, 12),
            depart_date=dt.date(2026, 4, 15),
            position=0,
        )
        kyoto = Stop(
            trip_id=trip.id,
            name="Kyoto",
            country_code="JP",
            tz="Asia/Tokyo",
            arrive_date=dt.date(2026, 4, 15),
            depart_date=dt.date(2026, 4, 18),
            position=1,
        )
        db.add_all([tokyo, kyoto])
        db.flush()

        hotel = Booking(
            trip_id=trip.id,
            stop_id=tokyo.id,
            kind=BookingKind.HOTEL,
            title="Hotel Gracery Shinjuku",
            provider="Booking.com",
            confirmation_code="BK-8891245",
            start_at=dt.datetime(2026, 4, 12, 15, 0, tzinfo=TOKYO),
            start_tz="Asia/Tokyo",
            end_at=dt.datetime(2026, 4, 15, 10, 0, tzinfo=TOKYO),
            end_tz="Asia/Tokyo",
            address="1-19-1 Kabukicho, Shinjuku",
            price_amount=Decimal("620.00"),
            price_currency="EUR",
        )

        bookings = [
            # The one that makes the two-zone design visible: it departs on
            # one clock and lands on another, the next day.
            Booking(
                trip_id=trip.id,
                kind=BookingKind.FLIGHT,
                title="Roma FCO → Tokyo HND",
                provider="ANA",
                confirmation_code="XK4T2P",
                start_at=dt.datetime(2026, 4, 11, 14, 5, tzinfo=ROME),
                start_tz="Europe/Rome",
                end_at=dt.datetime(2026, 4, 12, 9, 35, tzinfo=TOKYO),
                end_tz="Asia/Tokyo",
                origin_label="FCO Fiumicino",
                destination_label="HND Haneda",
                price_amount=Decimal("780.00"),
                price_currency="EUR",
                details={"flight_no": "NH204", "seat": "34K"},
            ),
            hotel,
            Booking(
                trip_id=trip.id,
                kind=BookingKind.ACTIVITY,
                title="teamLab Planets",
                confirmation_code="TL-77120",
                start_at=dt.datetime(2026, 4, 13, 10, 30, tzinfo=TOKYO),
                start_tz="Asia/Tokyo",
            ),
            Booking(
                trip_id=trip.id,
                kind=BookingKind.RESTAURANT,
                title="Cena a Omoide Yokocho",
                status=BookingStatus.PENDING,
                start_at=dt.datetime(2026, 4, 13, 20, 0, tzinfo=TOKYO),
                start_tz="Asia/Tokyo",
            ),
            Booking(
                trip_id=trip.id,
                stop_id=kyoto.id,
                kind=BookingKind.TRAIN,
                title="Shinkansen Tokyo → Kyoto",
                provider="JR Central",
                confirmation_code="NZ-4410",
                start_at=dt.datetime(2026, 4, 15, 11, 3, tzinfo=TOKYO),
                start_tz="Asia/Tokyo",
                end_at=dt.datetime(2026, 4, 15, 13, 15, tzinfo=TOKYO),
                end_tz="Asia/Tokyo",
                origin_label="Tokyo",
                destination_label="Kyoto",
            ),
            # Deliberately undated: the timeline has to have somewhere to put
            # a plan that is real but not yet scheduled.
            Booking(
                trip_id=trip.id,
                kind=BookingKind.OTHER,
                title="Ryokan a Hakone (da decidere)",
                status=BookingStatus.PENDING,
            ),
        ]
        db.add_all(bookings)

        db.add_all(
            [
                Place(
                    trip_id=trip.id,
                    stop_id=tokyo.id,
                    name="Senso-ji",
                    category=PlaceCategory.TEMPLE,
                    priority=Priority.MUST_SEE,
                    weather_exposure=WeatherExposure.OUTDOOR,
                    visit_minutes=90,
                    opening_hours={day: [["06:00", "17:00"]] for day in ("mon", "tue", "wed")},
                    # Already placed on the itinerary, so the timeline shows
                    # a visit sitting alongside the bookings.
                    planned_start_at=dt.datetime(2026, 4, 13, 8, 30, tzinfo=TOKYO),
                    planned_tz="Asia/Tokyo",
                ),
                Place(
                    trip_id=trip.id,
                    stop_id=tokyo.id,
                    name="Mori Art Museum",
                    category=PlaceCategory.MUSEUM,
                    weather_exposure=WeatherExposure.INDOOR,
                    visit_minutes=120,
                ),
            ]
        )

        db.add_all(
            [
                DayNote(
                    trip_id=trip.id,
                    day=dt.date(2026, 4, 12),
                    note="Ritirare il JR Pass alla stazione di Shinjuku prima delle 19.",
                ),
                DayNote(
                    trip_id=trip.id,
                    day=dt.date(2026, 4, 14),
                    note="Giornata libera. Il Mori Art Museum chiude il martedì.",
                ),
            ]
        )

        db.flush()
        attachment = Attachment(
            booking_id=hotel.id,
            kind=AttachmentKind.VOUCHER,
            filename="voucher-gracery.pdf",
            content_type="application/pdf",
            byte_size=len(VOUCHER),
            sha256=hashlib.sha256(VOUCHER).hexdigest(),
            storage=StorageBackend.DB,
        )
        db.add(attachment)
        db.flush()
        db.add(AttachmentBlob(attachment_id=attachment.id, data=VOUCHER))

        db.commit()
        print(
            f'Seeded "{TITLE}": 2 stops, {len(bookings)} bookings, '
            "2 places, 2 day notes, 1 attachment."
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
