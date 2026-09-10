"""Where attachment bytes live, behind one interface.

Today there is a single implementation, storing bytes in Postgres. The
indirection exists because the choice was forced by circumstance rather than
preference: Render's filesystem is ephemeral and Cloudflare R2 wants a linked
card. If either changes, a second implementation of this protocol plus an
environment variable is the whole migration.
"""

from typing import Protocol

from sqlalchemy.orm import Session

from app.enums import StorageBackend
from app.errors import AppError
from app.models import Attachment, AttachmentBlob


class AttachmentStorage(Protocol):
    backend: StorageBackend

    def put(self, db: Session, attachment: Attachment, data: bytes) -> None: ...

    def get(self, db: Session, attachment: Attachment) -> bytes: ...


class DbStorage:
    """Bytes in a `bytea` column, in a table of their own.

    Sizing sanity check: two weeks in Japan is roughly forty documents, PDFs
    of 100-800 KB and images downscaled client-side to about 500 KB — some
    25-40 MB, well inside Neon's free 0.5 GB. It stops being the right answer
    the day full-resolution diary photos start arriving.
    """

    backend = StorageBackend.DB

    def put(self, db: Session, attachment: Attachment, data: bytes) -> None:
        db.add(AttachmentBlob(attachment_id=attachment.id, data=data))

    def get(self, db: Session, attachment: Attachment) -> bytes:
        blob = db.get(AttachmentBlob, attachment.id)
        if blob is None:
            # The row exists but its bytes do not. Only reachable through a
            # partly-failed write or a hand-edited database, but a clear error
            # beats an empty download that looks like a corrupt file.
            raise AppError(
                "attachment_bytes_missing", "The file content is missing", status_code=500
            )
        return blob.data


def get_storage() -> AttachmentStorage:
    return DbStorage()
