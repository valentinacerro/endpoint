"""Reading a Google Takeout "saved places" export.

Takeout hands you one CSV per saved list, and its column headers are
translated into the language of the Google account — `Title,Note,URL` for
one person, `Titolo,Nota,URL` for another. Matching on header names would
work for exactly the accounts we happened to think of, so the columns are
identified by what they contain instead.

Stdlib `csv`, not pandas: this is a few hundred rows of three columns, and
a dataframe library is a lot of megabytes to carry on a 512 MB instance for
that.
"""

import csv
import io
import zipfile
from dataclasses import dataclass

from app.errors import AppError

#: Enough for any realistic saved list, and a bound on the work one upload
#: can ask the server to do.
MAX_ROWS = 1000
MAX_BYTES = 2_000_000

#: Bounds on a whole export. Takeout gives one CSV per saved list, and
#: nobody has fifty lists; the byte cap is measured *uncompressed*,
#: before anything is read, because a few kilobytes of zip can claim to
#: hold several gigabytes and a 512 MB instance would simply die.
MAX_LISTS = 50
MAX_UNCOMPRESSED_BYTES = 20_000_000

#: The first four bytes of every zip archive. Sniffed rather than trusting
#: the file name, which a browser will happily get wrong.
_ZIP_MAGIC = b"PK\x03\x04"

#: Header names worth preferring when they happen to be recognisable. Purely
#: an optimisation over the content sniffing below.
_TITLE_HEADERS = {"title", "titolo", "nome", "name", "nom", "titel", "título", "名前"}
_NOTE_HEADERS = {"note", "nota", "comment", "commento", "notes", "kommentar"}


@dataclass(frozen=True)
class TakeoutRow:
    name: str
    url: str | None
    note: str | None


def _looks_like_url(value: str) -> bool:
    return value.strip().startswith(("http://", "https://"))


def _pick_url_column(rows: list[dict[str, str]], headers: list[str]) -> str | None:
    """The column whose values are actually URLs."""
    best: tuple[int, str] | None = None
    for header in headers:
        hits = sum(1 for row in rows if _looks_like_url(row.get(header) or ""))
        if hits and (best is None or hits > best[0]):
            best = (hits, header)
    return best[1] if best else None


def _pick_title_column(headers: list[str], url_column: str | None) -> str | None:
    for header in headers:
        if header and header.strip().lower() in _TITLE_HEADERS:
            return header
    # Fall back to the first column that is not the URL — Takeout puts the
    # name first in every language.
    for header in headers:
        if header and header != url_column:
            return header
    return None


def _pick_note_column(headers: list[str], used: set[str]) -> str | None:
    for header in headers:
        if header and header not in used and header.strip().lower() in _NOTE_HEADERS:
            return header
    return None


def parse(content: bytes) -> list[TakeoutRow]:
    """Turn an exported CSV into rows we can make places out of."""
    if len(content) > MAX_BYTES:
        raise AppError(
            "file_too_large",
            "That export is larger than 2 MB",
            status_code=413,
            field="file",
        )

    try:
        # utf-8-sig: Takeout writes a byte-order mark, and without this the
        # first header arrives with an invisible character glued to it.
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise AppError("not_utf8", "The file is not readable as text", field="file") from exc

    reader = csv.DictReader(io.StringIO(text))
    headers = [h for h in (reader.fieldnames or []) if h]
    if not headers:
        raise AppError("empty_csv", "No columns found in that file", field="file")

    raw = list(reader)[:MAX_ROWS]
    if not raw:
        raise AppError("empty_csv", "That file has no rows", field="file")

    url_column = _pick_url_column(raw, headers)
    title_column = _pick_title_column(headers, url_column)
    note_column = _pick_note_column(headers, {url_column or "", title_column or ""})

    if title_column is None:
        raise AppError("no_title_column", "No name column found in that file", field="file")

    rows: list[TakeoutRow] = []
    for entry in raw:
        name = (entry.get(title_column) or "").strip()
        if not name:
            continue
        url = (entry.get(url_column) or "").strip() if url_column else ""
        note = (entry.get(note_column) or "").strip() if note_column else ""
        rows.append(
            TakeoutRow(
                name=name[:200],
                url=url or None,
                note=note[:4000] or None,
            )
        )
    return rows


@dataclass(frozen=True)
class Sheet:
    """One saved list out of an export."""

    #: Taken from the file name inside the archive, which is what Takeout
    #: calls the list — "Want to go", "Preferiti", "Ramen".
    name: str
    rows: list[TakeoutRow]


def looks_like_zip(content: bytes) -> bool:
    return content[:4] == _ZIP_MAGIC


def parse_export(content: bytes, fallback_name: str = "") -> list[Sheet]:
    """A whole Takeout archive, or a single CSV out of one.

    The archive is the point. Takeout gives you one zip containing a CSV
    per saved list, and making someone unpack it and upload the files one
    at a time is most of why that export is such a miserable way to move
    places. Dropping the zip in whole is the same information with none
    of the ceremony.
    """
    if not looks_like_zip(content):
        return [Sheet(name=fallback_name, rows=parse(content))]

    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise AppError("bad_archive", "That file is not a readable zip", status_code=400) from exc

    members = [
        entry
        for entry in archive.infolist()
        if not entry.is_dir()
        and entry.filename.lower().endswith(".csv")
        # The folder macOS adds to every archive it touches, full of
        # resource-fork twins that parse as empty lists.
        and not entry.filename.startswith("__MACOSX/")
    ]

    if not members:
        raise AppError(
            "no_lists_in_archive",
            "No saved lists (.csv) were found in that archive",
            status_code=400,
        )
    if len(members) > MAX_LISTS:
        raise AppError(
            "too_many_lists", f"More than {MAX_LISTS} lists in one file", status_code=400
        )

    # Checked before a single byte is decompressed: the declared size is
    # what a zip bomb lies about being small.
    if sum(entry.file_size for entry in members) > MAX_UNCOMPRESSED_BYTES:
        raise AppError("archive_too_large", "That archive unpacks to too much", status_code=400)

    sheets = []
    for entry in sorted(members, key=lambda item: item.filename):
        name = entry.filename.rsplit("/", 1)[-1].removesuffix(".csv").removesuffix(".CSV")
        try:
            rows = parse(archive.read(entry))
        except AppError:
            # One unreadable list must not lose the other eleven. An empty
            # sheet is reported rather than dropped, so the count adds up.
            rows = []
        sheets.append(Sheet(name=name, rows=rows))

    return sheets
