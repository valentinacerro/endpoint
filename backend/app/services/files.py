"""Reading and identifying an uploaded file, safely."""

from urllib.parse import quote

from fastapi import UploadFile, status

from app.errors import AppError

CHUNK = 64 * 1024

#: What we are willing to store. Deliberately short: these are travel
#: documents, and every extra type is another parser exposed to a file that
#: will later be opened on a phone.
ALLOWED_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}

EXTENSIONS = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def sniff_content_type(data: bytes) -> str | None:
    """Identify a file from its first bytes.

    The client's `Content-Type` header is a claim, not evidence: a browser
    will happily label anything, and on some platforms it sends
    `application/octet-stream` for a perfectly ordinary PDF. Deciding from the
    content means the stored type always matches what the file really is.
    """
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def read_within_limit(upload: UploadFile, limit: int) -> bytes:
    """Read the upload, refusing anything over the cap.

    Read in chunks and stop at the limit rather than reading first and
    checking after: otherwise a large upload is already in memory by the time
    it gets rejected, which on a 512 MB instance is how the service dies.
    """
    chunks: list[bytes] = []
    total = 0
    while chunk := upload.file.read(CHUNK):
        total += len(chunk)
        if total > limit:
            raise AppError(
                "file_too_large",
                f"The file exceeds the {limit // 1_000_000} MB limit",
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                field="file",
            )
        chunks.append(chunk)

    if total == 0:
        raise AppError("empty_file", "The file is empty", field="file")
    return b"".join(chunks)


def safe_filename(name: str | None, content_type: str) -> str:
    """A filename that is safe to store and to send back in a header."""
    fallback = f"document{EXTENSIONS.get(content_type, '')}"
    if not name:
        return fallback
    # Keep the basename only: a client is free to send "../../etc/passwd",
    # and while we never touch the filesystem, the name is echoed back in a
    # header and used by the browser when saving.
    cleaned = name.replace("\\", "/").rsplit("/", 1)[-1].strip()
    cleaned = "".join(ch for ch in cleaned if ch.isprintable() and ch not in '"\r\n')
    return cleaned[:255] or fallback


def content_disposition(filename: str) -> str:
    """`inline`, with the filename encoded for non-ASCII names.

    "受領書.pdf" is a perfectly normal name for a Japanese hotel voucher, and
    a bare `filename=` parameter cannot carry it.
    """
    ascii_fallback = filename.encode("ascii", "replace").decode("ascii").replace("?", "_")
    return f"inline; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename)}"
