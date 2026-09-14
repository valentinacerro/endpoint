from __future__ import annotations

import datetime as dt
import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, CheckConstraint, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import PlaceCategory, Priority, WeatherExposure
from app.models.base import Timestamps, UtcDateTime, UuidPk, enum_check

if TYPE_CHECKING:
    from app.models.stop import Stop
    from app.models.trip import Trip


class Place(Base, UuidPk, Timestamps):
    """Somewhere you would like to go, which is not a booking.

    A museum you intend to visit is not a reservation — it has no
    confirmation code and no fixed time. Bookings are the hard points of a
    day; places are what gets arranged around them. Keeping them apart is
    what lets the itinerary optimiser move one and never the other.
    """

    __tablename__ = "place"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), index=True
    )
    stop_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("stop.id", ondelete="SET NULL"), index=True
    )

    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(16), default=PlaceCategory.SIGHT)
    priority: Mapped[str] = mapped_column(String(16), default=Priority.NORMAL)

    # What the rain re-balancer swaps on. Stored rather than derived from the
    # category because the exceptions are the interesting part: a covered
    # arcade is shopping but sheltered, and a museum you are visiting for its
    # garden is not really indoors.
    weather_exposure: Mapped[str] = mapped_column(String(16), default=WeatherExposure.MIXED)

    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    address: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)
    #: One line saying what this is, and a photograph of it — both from
    #: Wikidata, both kept so they survive being chosen.
    #:
    #: Separate from `notes`, which is yours. A sentence the app fetched
    #: and a sentence you wrote are different things, and putting the
    #: first in the field meant for the second would make it impossible to
    #: refresh one without destroying the other.
    description: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)

    # How long you expect to stay. Without it an optimiser can order stops but
    # cannot tell you whether the day actually fits.
    visit_minutes: Mapped[int] = mapped_column(Integer, default=60)

    # When you plan to be here. Null means "on the wish list, not yet placed".
    # Same instant-plus-zone pairing as a booking, and for the same reason: a
    # visit at 10:00 in Kyoto has to read 10:00 while you are still at home.
    #
    # These live on the place itself rather than in a separate plan table, so
    # the itinerary optimiser will have somewhere to write its answer without
    # a new concept. The trade is that one place appears at most once in a
    # trip, which for a wish list is the normal case.
    planned_start_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime)
    planned_tz: Mapped[str | None] = mapped_column(String(64))

    # Opening hours, keyed by weekday:
    #   {"mon": [["09:00", "17:00"]], "tue": [], "wed": [["09:00", "12:00"],
    #    ["13:00", "17:00"]]}
    # An empty list means closed that day; a missing key means unknown, which
    # the optimiser must treat as "do not assume it is open".
    opening_hours: Mapped[dict[str, Any]] = mapped_column(
        MutableDict.as_mutable(JSON().with_variant(JSONB, "postgresql")),
        default=dict,
    )

    trip: Mapped[Trip] = relationship(back_populates="places")
    stop: Mapped[Stop | None] = relationship(back_populates="places")

    __table_args__ = (
        enum_check("category", PlaceCategory, "ck_place_category"),
        enum_check("priority", Priority, "ck_place_priority"),
        enum_check("weather_exposure", WeatherExposure, "ck_place_weather_exposure"),
        CheckConstraint("visit_minutes > 0", name="ck_place_visit_minutes_positive"),
        # An instant with no zone cannot be displayed, exactly as for bookings.
        CheckConstraint(
            "planned_start_at IS NULL OR planned_tz IS NOT NULL", name="ck_place_planned_tz"
        ),
        CheckConstraint("lat IS NULL OR (lat >= -90 AND lat <= 90)", name="ck_place_lat_range"),
        CheckConstraint("lon IS NULL OR (lon >= -180 AND lon <= 180)", name="ck_place_lon_range"),
    )
