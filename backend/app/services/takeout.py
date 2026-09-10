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
from dataclasses import dataclass

from app.errors import AppError

#: Enough for any realistic saved list, and a bound on the work one upload
#: can ask the server to do.
MAX_ROWS = 1000
MAX_BYTES = 2_000_000

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
