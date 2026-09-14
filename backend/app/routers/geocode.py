from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from app.enums import PlaceCategory
from app.limiter import limiter
from app.services import discover, geocode

router = APIRouter(prefix="/api/geo", tags=["geocode"])


class HitOut(BaseModel):
    name: str
    lat: float
    lon: float
    where: str | None
    address: str | None
    category: PlaceCategory


@router.get("/search", response_model=list[HitOut])
# Generous enough for typing, tight enough that a stuck key cannot turn
# this into a load generator pointed at somebody else's free service.
@limiter.limit("60/minute")
async def search_places(
    request: Request,
    q: Annotated[str, Query(min_length=2, max_length=120)],
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lon: Annotated[float | None, Query(ge=-180, le=180)] = None,
) -> list[geocode.Hit]:
    """Suggestions for a place being typed.

    Not attached to a trip: it reads nothing of yours, so it needs no
    trip in the path. It is still behind the app's authentication, like
    every other route under /api.
    """
    near = (lat, lon) if lat is not None and lon is not None else None
    return await geocode.search(q.strip(), near)


class SuggestionOut(BaseModel):
    name: str
    lat: float
    lon: float
    category: PlaceCategory
    #: How many Wikipedia language editions describe it. Sent so the screen
    #: can show why the order is what it is, and say nothing when it is 0 —
    #: which means "obscure" and "not linked to Wikidata" alike.
    fame: int
    wikidata: str | None
    osm_id: str


@router.get("/discover", response_model=list[SuggestionOut])
# Lower than the search box's: each call is a heavy query against a
# volunteer service, and nothing on a screen should fire it more than
# once per stop.
@limiter.limit("10/minute")
async def discover_places(
    request: Request,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    radius_km: Annotated[float, Query(gt=0, le=50)] = 8.0,
) -> list[discover.Suggestion]:
    """What there is to see around a point, the best known first.

    For a trip that arrives with no saved places: without this the planner
    has nothing to arrange, and an empty itinerary is not a plan.

    An empty list is a legitimate answer and not an error. Overpass is a
    volunteer service that falls over regularly, and a suggestion list
    that fails to appear is a disappointment where a 502 would be a bug.
    The client caches what it gets, so a second look costs nothing.
    """
    return await discover.around(lat, lon, radius_km)
