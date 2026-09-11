from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from app.enums import PlaceCategory
from app.limiter import limiter
from app.services import geocode

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
