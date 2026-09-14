"""Looking up a place by typing its name.

Photon, running on OpenStreetMap data. Free, no key, no account, no card
— and unlike Nominatim, whose usage policy asks people not to point
as-you-type search at it, Photon exists precisely for that.

Google's Places Autocomplete would give better results and needs a
billing account, which rules it out here on the same grounds as
everything else.

Two things about this being a proxy rather than a call from the browser.
It keeps the search terms off Komoot's doorstep with the reader's IP
attached — "ryokan kyoto onsen" typed into a box is travel data like any
other, and not scattering that around is the reason this app exists. And
it puts one rate limit in one place instead of trusting every screen to
behave. The cost is a hop through a server that may be waking up; by the
time you are adding a place it is awake, because saving the place needs
it too.
"""

from dataclasses import dataclass

import httpx

from app.enums import PlaceCategory
from app.errors import AppError
from app.services.agent import HEADERS
from app.services.zonetab import zone_for

_BASE = "https://photon.komoot.io/api/"
_TIMEOUT_SECONDS = 6.0

#: Short, because this is a dropdown under a text field and nobody reads
#: the ninth suggestion.
MAX_RESULTS = 6

#: Photon speaks default, de, en and fr — no Italian. English is the
#: better choice regardless for a trip to Japan: "Senso-ji Main Hall"
#: beats 浅草寺 on a screen you are reading in a hurry.
_LANG = "en"


@dataclass(frozen=True)
class Hit:
    name: str
    lat: float
    lon: float
    #: "Tokyo, Japan" — what tells two identically named ramen shops apart.
    where: str | None
    address: str | None
    category: PlaceCategory
    #: ISO 3166-1 alpha-2, when the source says. Carried because a stop
    #: needs a country and, through it, a time zone.
    country: str | None = None
    #: The IANA zone this place is in, when the country and position are
    #: enough to say. None rather than a guess: a wrong zone silently
    #: moves every booking of that stop to the wrong day.
    tz: str | None = None


#: OpenStreetMap's classification, mapped onto ours where it is certain.
#: Only the unambiguous pairs are here: a guess that saves one tap is not
#: worth a wrong category you have to notice and undo.
_BY_TAG: dict[tuple[str, str], PlaceCategory] = {
    ("tourism", "museum"): PlaceCategory.MUSEUM,
    ("tourism", "gallery"): PlaceCategory.MUSEUM,
    ("tourism", "viewpoint"): PlaceCategory.VIEWPOINT,
    ("tourism", "theme_park"): PlaceCategory.EXPERIENCE,
    ("tourism", "aquarium"): PlaceCategory.EXPERIENCE,
    ("tourism", "zoo"): PlaceCategory.EXPERIENCE,
    ("leisure", "park"): PlaceCategory.PARK,
    ("leisure", "nature_reserve"): PlaceCategory.PARK,
    ("leisure", "garden"): PlaceCategory.GARDEN,
    ("amenity", "restaurant"): PlaceCategory.FOOD,
    ("amenity", "cafe"): PlaceCategory.FOOD,
    ("amenity", "fast_food"): PlaceCategory.FOOD,
    ("amenity", "bar"): PlaceCategory.FOOD,
    ("amenity", "pub"): PlaceCategory.FOOD,
    ("amenity", "ice_cream"): PlaceCategory.FOOD,
    ("amenity", "food_court"): PlaceCategory.FOOD,
    ("amenity", "marketplace"): PlaceCategory.SHOPPING,
    # OSM tags these two specifically, which is the only way to tell a
    # temple from a shrine: `place_of_worship` alone does not say, and in
    # Japan guessing between them is wrong about half the time.
    ("building", "shrine"): PlaceCategory.SHRINE,
    ("building", "temple"): PlaceCategory.TEMPLE,
    ("natural", "peak"): PlaceCategory.VIEWPOINT,
    ("natural", "volcano"): PlaceCategory.VIEWPOINT,
}

#: Where the value is too varied to enumerate but the key already says
#: enough. Every kind of shop is shopping.
_BY_KEY: dict[str, PlaceCategory] = {
    "shop": PlaceCategory.SHOPPING,
    "historic": PlaceCategory.SIGHT,
}


def categorise(osm_key: str | None, osm_value: str | None) -> PlaceCategory:
    if osm_key and osm_value:
        exact = _BY_TAG.get((osm_key, osm_value))
        if exact:
            return exact
    if osm_key:
        broad = _BY_KEY.get(osm_key)
        if broad:
            return broad
    # The app's own default for a place someone has not classified. Being
    # wrong here costs one tap; being confidently wrong costs noticing.
    return PlaceCategory.SIGHT


def _where(props: dict) -> str | None:
    """A line of context under the name, coarse to fine."""
    parts = [props.get("city") or props.get("county"), props.get("state"), props.get("country")]
    seen = [str(part) for part in parts if part]
    # A city called the same as its prefecture would read "Tokyo, Tokyo".
    unique = list(dict.fromkeys(seen))
    return ", ".join(unique) or None


def _address(props: dict) -> str | None:
    street = props.get("street")
    if not street:
        return None
    number = props.get("housenumber")
    return f"{street} {number}".strip() if number else str(street)


def _hit(feature: dict) -> Hit | None:
    props = feature.get("properties") or {}
    coords = (feature.get("geometry") or {}).get("coordinates") or []
    name = props.get("name")

    # A result with no name is a street or a postcode: real to a
    # geocoder, useless as a place to visit.
    if not name or len(coords) < 2:
        return None

    try:
        lon, lat = float(coords[0]), float(coords[1])
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None

    country = props.get("countrycode")
    country = str(country).upper() if country else None

    return Hit(
        name=str(name),
        lat=lat,
        lon=lon,
        where=_where(props),
        address=_address(props),
        country=country,
        tz=zone_for(country, lat, lon),
        category=categorise(props.get("osm_key"), props.get("osm_value")),
    )


def parse(payload: dict) -> list[Hit]:
    features = payload.get("features") or []
    hits = (_hit(feature) for feature in features)
    return [hit for hit in hits if hit is not None][:MAX_RESULTS]


async def ask(
    client: httpx.AsyncClient, query: str, near: tuple[float, float] | None = None
) -> list[Hit]:
    """One search, against a client the caller owns.

    Taking the client rather than making one is what lets a test drive
    this through a mock transport, the same way the forecast does.
    """
    params: dict[str, str | int | float] = {"q": query, "limit": MAX_RESULTS, "lang": _LANG}
    if near is not None:
        params["lat"], params["lon"] = near

    try:
        response = await client.get(_BASE, params=params, headers=HEADERS)
        response.raise_for_status()
        return parse(response.json())
    except (httpx.HTTPError, ValueError) as exc:
        # NOT an empty list. That is what this used to do, and it meant
        # the screen said "no place by that name" for Tokyo — because the
        # service was answering 403, not because Tokyo is hard to find.
        # A search that finds nothing and a search that could not run are
        # different facts and the reader has to be told which.
        raise AppError(
            "lookup_unavailable",
            "The place lookup is not answering",
            status_code=503,
        ) from exc


async def search(query: str, near: tuple[float, float] | None = None) -> list[Hit]:
    """Places matching what has been typed, nearest first when we know
    where "near" is.

    The bias is the difference between useful and not: "ichiran ramen"
    unbiased offers Hong Kong first, and biased to Tokyo offers the
    Tokyo ones.
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        return await ask(client, query, near)


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


async def locate(name: str, near: tuple[float, float] | None = None) -> Hit | None:
    """The best single guess at where a saved place is.

    For putting a position on something that already has a name — a place
    imported from a link that carried no coordinates, or typed by hand.
    Returns None when the name is genuinely unknown, and raises when the
    lookup itself is unavailable, so a caller can tell the two apart.
    """
    for query in searchable(name):
        hits = await search(query, near)
        if hits:
            return hits[0]
    return None
