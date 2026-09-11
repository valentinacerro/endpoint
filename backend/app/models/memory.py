from __future__ import annotations

import datetime as dt
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import TimeSource
from app.models.base import Timestamps, UtcDateTime, UuidPk, enum_check

if TYPE_CHECKING:
    from app.models.trip import Trip


class Memory(Base, UuidPk, Timestamps):
    """Where a photo was taken — and deliberately not the photo.

    The trace of where you actually went, which is never quite the
    itinerary you planned. The image itself never leaves the device: the
    browser reads the coordinates out of the file's EXIF data and only
    those coordinates are sent. Neon's free tier is half a gigabyte and a
    fortnight of photographs is several times that, so storing them was
    never on the table — but the honest version of that limitation turns
    out to be the better design anyway, because it means a holiday's
    photographs are not sitting on someone else's server.

    What is stored is about a hundred bytes a photo. Three hundred
    photographs is thirty kilobytes.
    """

    __tablename__ = "memory"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), index=True
    )

    # Not nullable, unlike a place: a point with no position is not a
    # point on a map, and there would be nothing to show.
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)

    # The same instant-plus-zone pairing as everything else with a time on
    # it. The zone is where we believe you were, which is what the photo
    # should be displayed in — 14:20 in Kyoto, not 07:20 back home.
    taken_at: Mapped[dt.datetime] = mapped_column(UtcDateTime)
    taken_tz: Mapped[str] = mapped_column(String(64))

    # Whether the instant came from an offset recorded in the file or was
    # inferred from the zone we think you were standing in.
    time_source: Mapped[str] = mapped_column(String(16), default=TimeSource.ASSUMED)

    # Kept so you can find the picture again in your own gallery, which is
    # the only place it exists.
    filename: Mapped[str | None] = mapped_column(String(255))
    caption: Mapped[str | None] = mapped_column(Text)

    trip: Mapped[Trip] = relationship(back_populates="memories")

    __table_args__ = (
        enum_check("time_source", TimeSource, "ck_memory_time_source"),
        CheckConstraint("lat >= -90 AND lat <= 90", name="ck_memory_lat_range"),
        CheckConstraint("lon >= -180 AND lon <= 180", name="ck_memory_lon_range"),
    )
