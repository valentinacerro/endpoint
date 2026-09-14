"""Reading a Google Maps link.

Sharing a place from the Maps app gives you a `maps.app.goo.gl` short link
with nothing readable in it, so resolving one means following its redirect.
Fetching a URL a user handed us is exactly the shape of an SSRF hole, so the
host is checked against an allowlist before and after every hop, redirects
are followed by hand rather than by the client, and nothing from the
response body is ever returned.
"""

import re
from dataclasses import dataclass
from typing import Literal
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from app.errors import AppError
from app.services import geocode

#: Hosts we are willing to fetch. Google runs Maps on many country domains,
#: hence the suffix check rather than a flat list.
_ALLOWED_SUFFIXES = (
    "maps.app.goo.gl",
    "goo.gl",
    "google.com",
    "maps.google.com",
)
_ALLOWED_GOOGLE_CC = re.compile(r"^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$")

_MAX_REDIRECTS = 5
_TIMEOUT_SECONDS = 8.0

#: The place's own coordinates, as Maps encodes them in the `data` blob.
#: More trustworthy than the `@` pair, which is only where the map was
#: centred and can sit a street away from the pin.
_PLACE_COORDS = re.compile(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)")
#: The viewport centre: /@45.4642,9.1900,17z
_VIEWPORT_COORDS = re.compile(r"/@(-?\d+\.\d+),(-?\d+\.\d+)")
#: A bare "lat,lng" pair, as used by ?q= and ?query=
_BARE_COORDS = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")
_PLACE_NAME = re.compile(r"/place/([^/@]+)")


#: How the coordinates were arrived at, so the screen can say so.
#:   link      — read out of the URL itself, as Maps wrote them
#:   geocoded  — the URL carried only a name, and the geocoder placed it
#:   None      — no position at all
PositionSource = Literal["link", "geocoded"]


@dataclass(frozen=True)
class MapsPlace:
    name: str | None
    lat: float | None
    lon: float | None
    url: str
    position: PositionSource | None = None


def _host_allowed(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return False
    if any(host == suffix or host.endswith("." + suffix) for suffix in _ALLOWED_SUFFIXES):
        return True
    # google.it, google.co.jp and the rest.
    return bool(_ALLOWED_GOOGLE_CC.match(host))


def _valid_coords(lat: float, lon: float) -> bool:
    return -90 <= lat <= 90 and -180 <= lon <= 180


def parse_maps_url(url: str) -> MapsPlace:
    """Pull a name and coordinates out of a long Maps URL.

    Pure and offline: every field is optional, because Maps has many link
    shapes and a partial answer still saves typing.
    """
    parsed = urlparse(url)
    path = unquote(parsed.path)
    query = parse_qs(parsed.query)

    lat: float | None = None
    lon: float | None = None

    # The pin itself wins over where the map happened to be centred.
    for pattern in (_PLACE_COORDS, _VIEWPORT_COORDS):
        found = pattern.search(f"{parsed.path}?{parsed.query}")
        if found:
            candidate = (float(found.group(1)), float(found.group(2)))
            if _valid_coords(*candidate):
                lat, lon = candidate
                break

    if lat is None:
        for key in ("q", "query", "ll", "destination"):
            for value in query.get(key, []):
                found = _BARE_COORDS.match(value)
                if found:
                    candidate = (float(found.group(1)), float(found.group(2)))
                    if _valid_coords(*candidate):
                        lat, lon = candidate
                        break
            if lat is not None:
                break

    name: str | None = None
    found_name = _PLACE_NAME.search(path)
    if found_name:
        name = found_name.group(1).replace("+", " ").strip()
    if not name:
        for key in ("q", "query"):
            for value in query.get(key, []):
                if not _BARE_COORDS.match(value):
                    name = value.replace("+", " ").strip()
                    break
            if name:
                break

    # A "name" that is really a plus-code or a coordinate pair helps nobody.
    if name and (_BARE_COORDS.match(name) or len(name) < 2):
        name = None

    return MapsPlace(
        name=name, lat=lat, lon=lon, url=url, position="link" if lat is not None else None
    )


def searchable(name: str) -> list[str]:
    """The name to look up, then the shorter one worth trying after it.

    A share from Maps puts the whole postal address into the name —
    "Chao Chao Gyoza - Shijo Kawaramachi, 312-1 Junpucho, Shimogyo Ward,
    Kyoto, 600-8021, Japan" — and a geocoder handed eighty characters
    containing a postcode and a floor number matches nothing. Everything
    before the first comma is the part a human would type, and it is what
    actually resolves: of four real examples from a trip, one matched
    whole and all four matched trimmed.

    Both are tried, in that order, because the full string is the better
    query when it happens to work.
    """
    whole = name.strip()
    head = whole.split(",")[0].strip()
    return [whole] if head == whole or len(head) < 3 else [whole, head]


async def _placed_by_name(place: MapsPlace, near: tuple[float, float] | None) -> MapsPlace:
    """Give a place that has only a name its coordinates, by asking the geocoder.

    Google's share links do not always carry a position: a "Copy link" from
    the Android app can redirect to a URL that names the place and nothing
    else, and the page behind it draws its map with JavaScript, so there is
    nothing to read. Rather than save a place that cannot be put on the map
    — which is what used to happen — look the name up the same way the
    search box does, biased to where the trip is. The result says it was
    estimated, so the screen can too.
    """
    if place.lat is not None or not place.name:
        return place
    hits: list[geocode.Hit] = []
    for query in searchable(place.name):
        try:
            hits = await geocode.search(query, near)
        except AppError:
            # The lookup being down is not a reason to refuse the link.
            # The place is saved with its name and no position, which is
            # exactly what happened before this fallback existed.
            return place
        if hits:
            break
    if not hits:
        return place
    hit = hits[0]
    return MapsPlace(name=place.name, lat=hit.lat, lon=hit.lon, url=place.url, position="geocoded")


async def resolve(url: str, near: tuple[float, float] | None = None) -> MapsPlace:
    """Resolve a Maps link, following a short link if that is what it is.

    `near` is where the trip is, when known, so a name-only link is placed
    in the right city rather than at the most famous namesake.
    """
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        raise AppError("invalid_url", "That does not look like a link", field="url")
    if not _host_allowed(url):
        raise AppError(
            "not_a_maps_link",
            "Only Google Maps links can be read",
            field="url",
        )

    parsed = parse_maps_url(url)
    if parsed.lat is not None or parsed.name is not None:
        # A long link: everything it will ever tell us is in the URL. Only a
        # name means a request to the geocoder, never one to Google.
        return await _placed_by_name(parsed, near)

    # Nothing readable in the link itself, so it is a short one and has to be
    # followed. Redirects are handled here rather than by httpx so that every
    # hop can be checked against the allowlist — otherwise an open redirect
    # on a Google domain would be enough to point us anywhere.
    current = url
    async with httpx.AsyncClient(follow_redirects=False, timeout=_TIMEOUT_SECONDS) as client:
        for _ in range(_MAX_REDIRECTS):
            try:
                response = await client.get(current, headers={"User-Agent": "endpoint/1.0"})
            except httpx.HTTPError as exc:
                raise AppError("link_unreachable", "Could not open that link", field="url") from exc

            location = response.headers.get("location")
            if response.is_redirect and location:
                current = str(httpx.URL(current).join(location))
                if not _host_allowed(current):
                    raise AppError(
                        "not_a_maps_link",
                        "That link leads somewhere other than Google Maps",
                        field="url",
                    )
                found = parse_maps_url(current)
                if found.lat is not None:
                    return found
                continue
            break

    final = parse_maps_url(current)
    if final.lat is None and final.name is None:
        raise AppError(
            "nothing_in_link",
            "No place could be read from that link",
            field="url",
        )
    return await _placed_by_name(final, near)
