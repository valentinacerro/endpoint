from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import AttachmentKind, StorageBackend
from app.models.base import Timestamps, UuidPk, enum_check, exactly_one_not_null

if TYPE_CHECKING:
    from app.models.booking import Booking


class Attachment(Base, UuidPk, Timestamps):
    """Metadata for a document. The bytes live in AttachmentBlob.

    Ownership is three nullable foreign keys plus a CHECK that exactly one is
    set, rather than a generic `(owner_type, owner_id)` pair. That keeps real
    referential integrity and real ON DELETE CASCADE — which matters, because
    deleting a booking must take its voucher with it.
    """

    __tablename__ = "attachment"

    trip_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), index=True
    )
    stop_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("stop.id", ondelete="CASCADE"), index=True
    )
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("booking.id", ondelete="CASCADE"), index=True
    )

    kind: Mapped[str] = mapped_column(String(16), default=AttachmentKind.OTHER)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120))
    byte_size: Mapped[int] = mapped_column(Integer)

    # Content address: deduplicates re-uploads of the same voucher and doubles
    # as a strong ETag, which lets the phone cache a file forever.
    sha256: Mapped[str] = mapped_column(String(64), index=True)

    # Where the bytes actually are. Only "db" is implemented; the column exists
    # from day one so that moving to object storage later is a new class behind
    # the same interface rather than a migration of the whole model.
    storage: Mapped[str] = mapped_column(String(8), default=StorageBackend.DB)
    storage_key: Mapped[str | None] = mapped_column(String(255))

    booking: Mapped[Booking | None] = relationship(back_populates="attachments")
    blob: Mapped[AttachmentBlob | None] = relationship(
        back_populates="attachment",
        cascade="all, delete-orphan",
        passive_deletes=True,
        # Loading a 4 MB PDF by accident should be impossible: the download
        # endpoint queries the blob deliberately.
        lazy="raise",
        single_parent=True,
    )

    __table_args__ = (
        enum_check("kind", AttachmentKind, "ck_attachment_kind"),
        enum_check("storage", StorageBackend, "ck_attachment_storage"),
        exactly_one_not_null(
            "trip_id", "stop_id", "booking_id", name="ck_attachment_exactly_one_owner"
        ),
    )


class AttachmentBlob(Base):
    """The bytes, in a table of their own.

    Keeping them separate is the single most important structural choice here:
    no careless `select(Attachment)`, no lazy load, no list endpoint can ever
    drag a multi-megabyte document into memory.
    """

    __tablename__ = "attachment_blob"

    attachment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("attachment.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[bytes] = mapped_column(LargeBinary)

    attachment: Mapped[Attachment] = relationship(back_populates="blob")
