from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import ChecklistCategory
from app.models.base import Timestamps, UuidPk, enum_check

if TYPE_CHECKING:
    from app.models.trip import Trip


class ChecklistItem(Base, UuidPk, Timestamps):
    """One line of the packing list.

    The text is whatever you typed, in whatever language you typed it —
    unlike a category, it is your content and not a key. The starter list
    the app offers is generated in the interface language at the moment it
    is created and becomes yours from then on.
    """

    __tablename__ = "checklist_item"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(16), default=ChecklistCategory.OTHER)
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)

    trip: Mapped[Trip] = relationship(back_populates="checklist")

    __table_args__ = (
        enum_check("category", ChecklistCategory, "ck_checklist_category"),
        CheckConstraint("position >= 0", name="ck_checklist_position_non_negative"),
        Index("ix_checklist_trip_position", "trip_id", "position"),
    )
