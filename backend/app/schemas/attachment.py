import datetime as dt
import uuid

from app.enums import AttachmentKind, StorageBackend
from app.schemas.common import ReadModel


class AttachmentRead(ReadModel):
    """Metadata only.

    There is no field here for the bytes, and that is the point: no list
    endpoint, no bundle and no careless serialisation can ever return a
    multi-megabyte document. The bytes have their own streaming endpoint.
    """

    id: uuid.UUID
    trip_id: uuid.UUID | None
    stop_id: uuid.UUID | None
    booking_id: uuid.UUID | None
    kind: AttachmentKind
    filename: str
    content_type: str
    byte_size: int
    # Content address: doubles as the ETag, which lets the phone keep a file
    # cached forever without ever revalidating it.
    sha256: str
    storage: StorageBackend
    created_at: dt.datetime
