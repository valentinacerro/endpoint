from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import Timestamps, UuidPk

if TYPE_CHECKING:
    from app.models.trip import Trip

#: Coordinates are rounded to four decimals before being stored or matched —
#: about eleven metres, which is inside the disagreement between two
#: geocoders about the same building and far below the distance at which a
#: journey changes. Without rounding, the same pair of places saved from two
#: sources would never match the correction you typed for it.
PRECISION = 4


def key(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat, PRECISION), round(lon, PRECISION))


class TravelTime(Base, UuidPk, Timestamps):
    """How long one leg really takes, because you looked it up.

    Everything else in this app estimates: straight-line distance times a
    detour factor, divided by an effective speed. Measured against real
    routing that is within a few per cent on DISTANCE and systematically
    over-long on TIME, because it cannot know whether a railway line
    actually joins two points — Senso-ji to Shibuya comes out fifty-four
    minutes against a real thirty-five.

    There is no free way to fix that in general: the GTFS data for Japan is
    open, but routing on it needs a server this app will never have. What
    there is instead is you, once, with a timetable open. A number you
    checked beats any model, and this is where it is kept.

    Stored against coordinates rather than place ids so that a correction
    survives renaming a place, deleting it, or saving the same spot twice
    from two different links.
    """

    __tablename__ = "travel_time"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), index=True
    )
    from_lat: Mapped[float] = mapped_column(Float)
    from_lon: Mapped[float] = mapped_column(Float)
    to_lat: Mapped[float] = mapped_column(Float)
    to_lon: Mapped[float] = mapped_column(Float)
    minutes: Mapped[int] = mapped_column(Integer)

    trip: Mapped[Trip] = relationship(back_populates="travel_times")

    __table_args__ = (
        # One correction per ordered pair. Ordered, not unordered: a climb
        # up to a temple and the walk back down are not the same journey,
        # and the direction is free to store.
        UniqueConstraint(
            "trip_id",
            "from_lat",
            "from_lon",
            "to_lat",
            "to_lon",
            name="uq_travel_time_leg",
        ),
    )
