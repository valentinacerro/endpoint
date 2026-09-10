import hashlib
import uuid
from typing import Annotated

from fastapi import APIRouter, File, Form, Request, Response, UploadFile, status
from sqlalchemy import ColumnElement, and_, select

from app.deps import AppSettings, DbSession
from app.enums import AttachmentKind
from app.errors import AppError
from app.models import Attachment, Booking, Stop, Trip
from app.schemas.attachment import AttachmentRead
from app.services import storage as storage_service
from app.services.bundle import attachments_of_trip
from app.services.files import (
    ALLOWED_TYPES,
    content_disposition,
    read_within_limit,
    safe_filename,
    sniff_content_type,
)
from app.services.http import etag_matches
from app.services.lookup import child_of_trip, get_or_404

router = APIRouter(prefix="/api/trips/{trip_id}/attachments", tags=["attachments"])


def _optional_uuid(raw: str | None, field: str) -> uuid.UUID | None:
    """Parse an optional id from a form field.

    A browser sends an empty string for an untouched field, which is not the
    same as omitting it — without this, every upload from a real form would
    fail validation on a field the user never filled in.
    """
    if raw is None or raw.strip() == "":
        return None
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        raise AppError("invalid_uuid", f"{field} is not a valid id", field=field) from exc


def _same_owner(owner: dict[str, uuid.UUID | None]) -> ColumnElement[bool]:
    """Match rows with exactly this owner, nulls included.

    `column == None` renders as `= NULL`, which is never true in SQL, so the
    null sides have to use `IS NULL` explicitly — otherwise the duplicate
    check silently never matches.
    """
    return and_(
        *(
            getattr(Attachment, column).is_(None)
            if value is None
            else getattr(Attachment, column) == value
            for column, value in owner.items()
        )
    )


def _attachment_of_trip(db: DbSession, attachment_id: uuid.UUID, trip_id: uuid.UUID):
    """Find an attachment reachable from this trip.

    Not `child_of_trip`: an attachment owned by a booking has a null
    `trip_id`, so it has to be matched through its owner instead.
    """
    attachment = db.scalar(
        select(Attachment).where(Attachment.id == attachment_id, attachments_of_trip(trip_id))
    )
    if attachment is None:
        raise AppError("attachment_not_found", "Attachment not found", status_code=404)
    return attachment


@router.get("", response_model=list[AttachmentRead])
def list_attachments(trip_id: uuid.UUID, db: DbSession) -> list[Attachment]:
    get_or_404(db, Trip, trip_id)
    return list(
        db.scalars(
            select(Attachment).where(attachments_of_trip(trip_id)).order_by(Attachment.created_at)
        )
    )


@router.post("", response_model=AttachmentRead, status_code=status.HTTP_201_CREATED)
def upload_attachment(
    trip_id: uuid.UUID,
    db: DbSession,
    settings: AppSettings,
    file: Annotated[UploadFile, File()],
    kind: Annotated[AttachmentKind, Form()] = AttachmentKind.OTHER,
    stop_id: Annotated[str | None, Form()] = None,
    booking_id: Annotated[str | None, Form()] = None,
) -> Attachment:
    get_or_404(db, Trip, trip_id)

    owner_stop = _optional_uuid(stop_id, "stop_id")
    owner_booking = _optional_uuid(booking_id, "booking_id")
    if owner_stop and owner_booking:
        raise AppError(
            "ambiguous_owner",
            "Attach the file to a stop or to a booking, not both",
            field="booking_id",
        )
    if owner_stop:
        child_of_trip(db, Stop, owner_stop, trip_id)
    if owner_booking:
        child_of_trip(db, Booking, owner_booking, trip_id)

    data = read_within_limit(file, settings.max_upload_bytes)

    # The stored type comes from the bytes, never from the client's claim.
    content_type = sniff_content_type(data)
    if content_type not in ALLOWED_TYPES:
        raise AppError(
            "unsupported_file_type",
            "Only PDF, JPEG, PNG and WebP files are accepted",
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            field="file",
        )

    digest = hashlib.sha256(data).hexdigest()
    owner = {
        "trip_id": None if (owner_stop or owner_booking) else trip_id,
        "stop_id": owner_stop,
        "booking_id": owner_booking,
    }

    # Tapping "upload" twice on a slow connection is the common case, and it
    # should not produce two copies of the same voucher.
    duplicate = db.scalar(select(Attachment).where(Attachment.sha256 == digest, _same_owner(owner)))
    if duplicate is not None:
        return duplicate

    storage = storage_service.get_storage()
    attachment = Attachment(
        **owner,
        kind=kind,
        filename=safe_filename(file.filename, content_type),
        content_type=content_type,
        byte_size=len(data),
        sha256=digest,
        storage=storage.backend,
    )
    db.add(attachment)
    db.flush()
    storage.put(db, attachment, data)
    db.commit()
    return attachment


@router.get("/{attachment_id}/file")
def download_attachment(
    trip_id: uuid.UUID,
    attachment_id: uuid.UUID,
    request: Request,
    db: DbSession,
) -> Response:
    attachment = _attachment_of_trip(db, attachment_id, trip_id)

    # The content is addressed by its own hash, so the tag can never be stale
    # and the file can be cached on the phone indefinitely.
    etag = f'"{attachment.sha256}"'
    if etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})

    data = storage_service.get_storage().get(db, attachment)

    # A plain Response rather than StreamingResponse: the bytes come out of a
    # `bytea` column, so SQLAlchemy has already materialised all of them.
    # Streaming here would look careful while saving nothing.
    return Response(
        content=data,
        media_type=attachment.content_type,
        headers={
            "ETag": etag,
            "Cache-Control": "private, max-age=31536000, immutable",
            "Content-Disposition": content_disposition(attachment.filename),
            # These are documents rendered inside the app; never let a
            # browser sniff them into something executable.
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(trip_id: uuid.UUID, attachment_id: uuid.UUID, db: DbSession) -> None:
    attachment = _attachment_of_trip(db, attachment_id, trip_id)
    db.delete(attachment)
    db.commit()
