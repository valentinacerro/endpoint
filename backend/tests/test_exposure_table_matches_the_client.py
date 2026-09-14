"""The two copies of the default-exposure table must agree.

A place created with no network is drawn from the client's own guess at
what the server would have stored, so the client carries its own copy of
this table. Two copies of anything drift; this is the thread that stops
them. It lives on the Python side because Python is the source of truth
and because a category added here is the case that would otherwise slip.
"""

import re
from pathlib import Path

from app.enums import DEFAULT_EXPOSURE, PlaceCategory, default_exposure

CLIENT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "exposure.ts"


def _client_table() -> dict[str, str]:
    source = CLIENT.read_text()
    body = re.search(r"DEFAULT_EXPOSURE[^=]*=\s*\{(.*?)\n\}", source, re.S)
    assert body, "could not find DEFAULT_EXPOSURE in exposure.ts"
    return dict(re.findall(r"^\s*(\w+):\s*'(\w+)',", body.group(1), re.M))


def test_the_client_table_is_the_same_table() -> None:
    mine = {category.value: exposure.value for category, exposure in DEFAULT_EXPOSURE.items()}
    assert _client_table() == mine


def test_every_category_the_client_knows_has_the_same_answer() -> None:
    """Including the ones that fall through to the default."""
    fallback = re.search(r"\?\?\s*'(\w+)'", CLIENT.read_text())
    assert fallback, "could not find the fallback in exposure.ts"
    table = _client_table()
    for category in PlaceCategory:
        expected = default_exposure(category).value
        assert table.get(category.value, fallback.group(1)) == expected, category
