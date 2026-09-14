"""Finding places to see, when you have not collected any yourself.

Not everyone arrives with a Google Maps list. Without one the planner has
nothing to arrange, and an empty itinerary is not a plan — so this asks
OpenStreetMap what is around each stop and ranks the answers.

Two free sources, no key and no card between them:

  Overpass is OpenStreetMap's own query API. It knows what is where and
  what kind of thing it is, and nothing at all about whether anyone would
  want to go. A radius around Shibuya returns several hundred entries in
  which a world-famous shrine and a plaque on a wall are peers.

  Wikidata supplies the missing half. An OSM object often carries a
  `wikidata` tag, and Wikidata knows how many Wikipedia language editions
  describe that entity — seventy-two for Tokyo Skytree, forty-eight for
  Senso-ji, two for a neighbourhood museum, none for a local shrine. It is
  a proxy for fame, not for whether you personally would enjoy it, which
  is why what comes out of here is a suggestion you accept rather than an
  itinerary that appears.

  One trap, found by reading the first real list this produced: mappers
  put the `wikidata` of the person COMMEMORATED on a statue, not of the
  statue. Ranked naively, a knee-high plaque in a park came top of
  Asakusa on Ulysses S. Grant's two hundred and seventy Wikipedia
  articles, and Senso-ji was nowhere. So the query asks Wikidata to leave
  out anything that is an instance of human, which it can do in the same
  breath as the counting.

Overpass is a volunteer service with no promise of being up: while this
was being written the main instance answered 504 twice and timed out
once. Hence the mirrors, the short timeout, and — more importantly — the
caching the caller does, so a second look at the same city costs nothing
and a bad afternoon for Overpass is not a broken feature.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from math import cos, radians

import httpx

from app.enums import PlaceCategory
from app.services.geocode import categorise

#: Tried in order. The main instance is the most complete and the most
#: loaded; the second exists for exactly this reason.
#:
#: This list used to hold two more, and they were worse than nothing.
#: Measured, every instance below, with a trivial query, a generous
#: timeout, both user agents and both methods:
#:
#:   overpass-api.de        1-7s when it answers, 504 under load
#:   maps.mail.ru           ~9s, answers for Tokyo and for Bern
#:   overpass.kumi.systems  times out, every time, every way
#:   overpass.private.coffee  times out, every time, every way
#:   overpass.openstreetmap.ru  does not connect
#:   overpass.osm.ch        0.3s — and no data outside Switzerland
#:
#: The two that timed out were in this tuple, so whenever the main
#: instance was busy a search spent sixty seconds failing and then said it
#: had found nothing. That is the whole of why "cerco cosa vedere…" could
#: sit there for a minute and a quarter.
#:
#: `overpass.osm.ch` is deliberately NOT here despite being the fastest of
#: the lot. It answers 200 with an empty list for anywhere outside
#: Switzerland, which this code cannot tell from "there is nothing in
#: Tokyo" — a mirror that lies quietly is worse than one that fails.
_OVERPASS = (
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
#: The query service, not the entity API: asking `wbgetentities` for
#: claims costs about 130 MB for a city's worth of ids, and one SPARQL
#: query answers the count and the is-it-a-person question together in
#: about a kilobyte.
_WIKIDATA = "https://query.wikidata.org/sparql"

#: Wikimedia asks for an agent that says who is calling; anonymous ones
#: are answered with 403.
_USER_AGENT = "endpoint/1.0 (personal travel planner; https://github.com/valentinacerro/endpoint)"

#: Long enough for the `[timeout:25]` the query itself declares, and no
#: longer: past that the server has given up and we are waiting on a
#: socket nobody is going to write to.
_OVERPASS_TIMEOUT = 27.0
#: Between the two asks of a busy instance. Short: it is a queue, not an
#: outage.
_RETRY_PAUSE = 1.0
_WIKIDATA_TIMEOUT = 25.0

#: How many ids go into one SPARQL `VALUES` clause. Large enough that a
#: city is one or two calls, small enough to stay well inside the query
#: service's limits.
_WIKIDATA_BATCH = 300

#: Below this many results, ask again without the Wikidata requirement.
#:
#: Measured on a 5 km box, places the narrow query returns against places
#: it returns without `["wikidata"]`:
#:
#:   Tokyo      711 -> (not needed)      Marrakech   13 ->  107
#:   Kyoto       60 -> (not needed)      Bariloche    2 ->   95
#:   Lisbon      60 -> (not needed)      Nairobi      0 ->  645
#:   Lima        60 -> (not needed)      Kathmandu    0 -> 1160
#:
#: The tag is added by the kind of mapper who links things to Wikidata,
#: which is a good description of where OSM is richly curated and a bad
#: description of where a person might go. Requiring it did not make the
#: suggestions shorter in Nairobi; it made them empty.
#:
#: The wider query is slower — 3 to 17 seconds where it runs — and is only
#: ever run where the narrow one failed, which is to say in the smaller
#: places where it is also cheaper. In a city where the narrow query works
#: nothing extra is asked for at all.
#: Wide enough to recognise a building, small enough to send twenty of.
_THUMBNAIL_WIDTH = 320

_THIN = 20

#: The longest this may take, whatever happens inside it.
#:
#: Measured: a narrow query that works is 1-7 seconds, a wider one that
#: works is 3-17, and the pathological case — thin, then refused by every
#: instance — ran to eighty-five. Thirty covers every measured success
#: with room to spare and cuts the failures off while a person is still
#: willing to wait.
_DEADLINE = 30.0

#: What counts as somewhere you might go. Three decisions are load-bearing,
#: and all three were measured rather than guessed on a 5 km box over
#: central Tokyo:
#:
#:  - Narrow tags. OSM will happily return post boxes and drinking
#:    fountains under a broad `amenity`.
#:  - `nw`, not `nwr`. Relations are what make this query slow: with them
#:    the main instance answered 504 and the mirror timed out at forty
#:    seconds; without them, 901 of 938 objects in 5.6 seconds.
#:  - `["wikidata"]`. Only an object Wikidata knows can be ranked at all,
#:    and the rest would be unsorted filler under the part you read. It
#:    does mean a place OSM knows and Wikidata does not is missing from
#:    the suggestions — which is a real cost, paid because a list you
#:    scroll past is worth less than a short one you use.
_QUERY = """
[out:json][timeout:25];
(
  nw["wikidata"]["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park)$"]{area};
  nw["wikidata"]["historic"~"^(castle|monument|ruins|city_gate|fort|archaeological_site)$"]{area};
  nw["wikidata"]["amenity"~"^(place_of_worship|theatre)$"]{area};
  nw["wikidata"]["leisure"~"^(park|garden)$"]{area};
);
out center tags;
"""


@dataclass(frozen=True)
class Suggestion:
    name: str
    lat: float
    lon: float
    category: PlaceCategory
    #: How many Wikipedia language editions describe it. 0 means either
    #: genuinely obscure or simply not linked to Wikidata in OSM — the two
    #: are indistinguishable here, which is why this only ever ranks.
    fame: int
    #: The Wikidata entity, when OSM names one. Carried so a caller can
    #: cache by it and so a reader can go and look it up.
    wikidata: str | None
    osm_id: str
    #: One line saying what the thing actually is, from Wikidata. A name
    #: on its own does not tell you whether "Gokokuji" is a temple from
    #: 1681 or a car park, which is the whole reason a list of suggestions
    #: was hard to use. None when nothing describes it in any language we
    #: asked for — which is every place the wider query found, since that
    #: query exists precisely because Wikidata does not know them.
    description: str | None = None
    #: A photograph, already sized for a list. Wikidata's P18 points at the
    #: original: four megabytes for the Tokyo National Museum, 25 KB at the
    #: 320 pixels asked for here.
    image: str | None = None


def _bbox(lat: float, lon: float, radius_km: float) -> str:
    """A bounding box, in degrees, around a point.

    A box rather than Overpass's `around` filter: `around` is markedly
    slower on a loaded instance, and the corners it adds are trimmed by
    distance afterwards anyway.
    """
    # 111.32 km per degree of latitude; longitude shrinks with the cosine,
    # and near the poles it stops meaning anything — clamped so a trip to
    # Svalbard produces a wide box rather than a division by zero.
    dlat = radius_km / 111.32
    dlon = radius_km / max(111.32 * cos(radians(lat)), 1.0)
    return f"({lat - dlat:.5f},{lon - dlon:.5f},{lat + dlat:.5f},{lon + dlon:.5f})"


def _tag_of(tags: dict[str, str]) -> tuple[str | None, str | None]:
    """The one OSM tag that says what this is, in the order we trust them.

    `building` comes first because it is the only tag that separates a
    temple from a shrine — `amenity=place_of_worship` does not say, and in
    Japan guessing between them is wrong about half the time. Senso-ji is
    tagged as an attraction, a place of worship AND a temple building; the
    last of those is the one worth keeping.
    """
    for key in ("building", "tourism", "historic", "leisure", "amenity"):
        value = tags.get(key)
        if value and (key != "building" or value in ("temple", "shrine", "church")):
            return key, value
    return None, None


def parse(payload: dict) -> list[Suggestion]:
    """Turn an Overpass answer into candidates, dropping what cannot be used.

    Pure, so the shape of the answer can be tested without a network. A
    place with no name is dropped: a row reading "Attraction" helps nobody
    choose.
    """
    out: list[Suggestion] = []
    seen: set[str] = set()

    for element in payload.get("elements", []):
        tags = element.get("tags") or {}
        name = tags.get("name:en") or tags.get("name")
        if not name:
            continue

        # A node carries its own position; a way or relation carries a
        # computed centre, which is what `out center` is for.
        centre = element.get("center") or element
        lat, lon = centre.get("lat"), centre.get("lon")
        if lat is None or lon is None:
            continue

        osm_id = f"{element.get('type', 'node')}/{element.get('id')}"
        # The same church can come back under two tags in one answer.
        key = tags.get("wikidata") or osm_id
        if key in seen:
            continue
        seen.add(key)

        osm_key, osm_value = _tag_of(tags)
        out.append(
            Suggestion(
                name=str(name),
                lat=float(lat),
                lon=float(lon),
                category=categorise(osm_key, osm_value),
                fame=0,
                wikidata=tags.get("wikidata"),
                osm_id=osm_id,
            )
        )
    return out


async def _overpass(client: httpx.AsyncClient, query: str) -> dict | None:
    """Ask each instance in turn, and give up quietly.

    Quietly because the caller has a cache and a screen to draw: a
    suggestion list that fails to appear is a disappointment, and one that
    raises is a broken button.

    A 5xx is asked again once before moving on. Measured against the main
    instance: 504, 504, then 200 in 1.1 seconds. Its overload is measured
    in seconds, so one more ask is worth more than one more mirror.
    """
    for url in _OVERPASS:
        for attempt in (1, 2):
            try:
                response = await client.post(
                    url, data={"data": query}, headers={"User-Agent": _USER_AGENT}
                )
                if response.status_code == 200:
                    return response.json()
                # 4xx is about the query and will be 4xx again; only a
                # server that is merely busy is worth asking twice.
                if response.status_code < 500 or attempt == 2:
                    break
                await asyncio.sleep(_RETRY_PAUSE)
            except (httpx.HTTPError, ValueError):
                break
    return None


def _sparql(ids: list[str], lang: str) -> str:
    """Count the language editions, say what the thing is, and show it.

    `FILTER NOT EXISTS { ?item wdt:P31 wd:Q5 }` is the whole defence
    against ranking a statue by the fame of its subject. An entity that
    fails it is simply absent from the answer, which the caller reads as
    a count of zero — correct, since the statue itself is not notable.

    Both languages are asked for, not one. Measured on sixty places in
    Lisbon: English described all sixty-six rows and Italian
    twenty-seven, so asking only for the reader's language would leave
    three descriptions in five blank. English is the fallback, never the
    preference.

    The `OPTIONAL`s are what keep this one query: an entity with no
    description and no photograph still comes back with its count, where
    an inner join would drop it and quietly cost it its ranking.
    """
    values = " ".join(f"wd:{qid}" for qid in ids)
    return f"""SELECT ?item ?links ?desc ?img WHERE {{
  VALUES ?item {{ {values} }}
  ?item wikibase:sitelinks ?links .
  FILTER NOT EXISTS {{ ?item wdt:P31 wd:Q5 }}
  OPTIONAL {{ ?item schema:description ?desc .
             FILTER(LANG(?desc) IN ("{lang}", "en")) }}
  OPTIONAL {{ ?item wdt:P18 ?img }}
}}"""


@dataclass(frozen=True)
class Detail:
    """What Wikidata knows about one entity."""

    links: int
    description: str | None
    image: str | None


def _thumbnail(url: str) -> str:
    """The same picture, at a size a phone list can afford.

    P18 points at the original upload. Measured on the Tokyo National
    Museum: four megabytes as given, 196 KB at 640 pixels, 25 KB at 320.
    Commons resizes on request, so this is a suffix and not a second call.
    """
    return f"{url}?width={_THUMBNAIL_WIDTH}"


async def about(client: httpx.AsyncClient, ids: list[str], lang: str) -> dict[str, Detail]:
    """What each entity is, how well known, and a picture of it.

    Failure returns an empty map rather than raising: without it the
    suggestions are merely unsorted and unillustrated, which is a great
    deal better than none at all.

    One row per item is kept, not the last. An entity commonly has both an
    Italian and an English description and more than one photograph, and
    SPARQL returns the cross product — so taking the last would mean the
    reader's language wins or loses depending on the order a server felt
    like emitting.
    """
    details: dict[str, Detail] = {}
    for start in range(0, len(ids), _WIKIDATA_BATCH):
        batch = ids[start : start + _WIKIDATA_BATCH]
        try:
            response = await client.get(
                _WIKIDATA,
                params={"query": _sparql(batch, lang), "format": "json"},
                headers={
                    "User-Agent": _USER_AGENT,
                    "Accept": "application/sparql-results+json",
                },
            )
            response.raise_for_status()
            rows = response.json()["results"]["bindings"]
        except (httpx.HTTPError, ValueError, KeyError):
            continue
        for row in rows:
            qid = row["item"]["value"].rsplit("/", 1)[-1]
            said = row.get("desc", {}).get("value")
            language = row.get("desc", {}).get("xml:lang")
            picture = row.get("img", {}).get("value")
            before = details.get(qid)
            details[qid] = Detail(
                links=int(row["links"]["value"]),
                # The reader's language beats English, whichever arrived
                # first; English beats nothing.
                description=(
                    said
                    if language == lang
                    else (before.description if before and before.description else said)
                ),
                image=(before.image if before and before.image else picture),
            )
    return details


def _told(place: Suggestion, detail: Detail | None) -> Suggestion:
    """The same place, with what Wikidata said about it.

    A place Wikidata says nothing about keeps a count of zero and no
    description, which is honest: it means either genuinely obscure or
    simply not linked, and this cannot tell those apart.
    """
    return Suggestion(
        **{
            **place.__dict__,
            "fame": detail.links if detail else 0,
            "description": detail.description if detail else None,
            "image": _thumbnail(detail.image) if detail and detail.image else None,
        }
    )


async def around(
    lat: float,
    lon: float,
    radius_km: float = 8.0,
    limit: int = 60,
    lang: str = "en",
) -> list[Suggestion]:
    """Places worth seeing near a point, the best known first.

    `limit` trims the ANSWER, never the pool. Capping the Overpass query
    instead was the first version's mistake: Overpass returns in id order,
    not in any order of interest, so asking it for a hundred and twenty of
    four thousand meant ranking an arbitrary slice — and Senso-ji was not
    in it.
    """
    area = _bbox(lat, lon, radius_km)
    found: list[Suggestion] = []

    # One ceiling over the whole thing, not a timeout per request.
    #
    # There are up to four asks in here — two instances for each of two
    # queries — and each may retry, so the per-request timeouts multiply.
    # Measured, at Bariloche, where the narrow query comes back thin and
    # the wider one is refused as well: eighty-five seconds, and then
    # nothing. Whatever has arrived by the deadline is a better answer
    # than a screen still saying "cerco cosa vedere" a minute and a half
    # later, and the caller is told which cities came back empty.
    try:
        async with asyncio.timeout(_DEADLINE):
            async with httpx.AsyncClient(timeout=_OVERPASS_TIMEOUT) as client:
                payload = await _overpass(client, _QUERY.replace("{area}", area))
                found = parse(payload) if payload else []

                # Ask again without the Wikidata requirement when the
                # first ask came back thin. See `_THIN` for why this is
                # not most cities.
                if len(found) < _THIN:
                    wider = await _overpass(
                        client, _QUERY.replace('["wikidata"]', "").replace("{area}", area)
                    )
                    if wider is not None:
                        seen = {place.osm_id for place in found}
                        found = found + [
                            place for place in parse(wider) if place.osm_id not in seen
                        ]

            qids = [place.wikidata for place in found if place.wikidata]
            if qids:
                async with httpx.AsyncClient(timeout=_WIKIDATA_TIMEOUT) as client:
                    known = await about(client, qids, lang)
                found = [_told(place, known.get(place.wikidata or "")) for place in found]
    except TimeoutError:
        # Deliberately not re-raised. Places without their fame scores
        # still rank by nearness, and half an answer is worth having.
        pass

    return rank(found, (lat, lon))[:limit]


def rank(places: list[Suggestion], centre: tuple[float, float] | None = None) -> list[Suggestion]:
    """Best known first, then nearest to where you are staying.

    The second half matters more than it looks, and it used to be
    alphabetical. That was survivable while every entry had a Wikidata
    link and so a real score; it stopped being survivable when the wider
    query came in, because a city that needs the wider query has *no*
    scores at all. Kathmandu returns eleven hundred places that way, and
    an alphabetical sort trimmed to sixty is sixty small stupas beginning
    with A.

    Nearest-first is not a measure of interest and does not pretend to be.
    It is the least arbitrary order available without asking someone: you
    are sleeping at the centre of this circle, so the near thing is more
    likely to be the thing you would walk to. The list is ordered
    properly, by a model on the phone, one step later.
    """
    if centre is None:
        return sorted(places, key=lambda place: (-place.fame, place.name.casefold()))
    lat, lon = centre
    scale = cos(radians(lat))
    return sorted(
        places,
        key=lambda place: (
            -place.fame,
            (place.lat - lat) ** 2 + ((place.lon - lon) * scale) ** 2,
            place.name.casefold(),
        ),
    )


__all__ = ["Detail", "Suggestion", "about", "around", "parse", "rank"]
