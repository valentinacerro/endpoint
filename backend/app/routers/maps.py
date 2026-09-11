from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.limiter import limiter
from app.services import maps
from app.services.maps import MapsPlace

router = APIRouter(prefix="/api/maps", tags=["maps"])


class ResolveIn(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    #: Where the trip is, so a link that names a place without placing it
    #: is looked up in the right city. Optional: without it the geocoder
    #: answers with the most famous namesake.
    near_lat: float | None = Field(default=None, ge=-90, le=90)
    near_lon: float | None = Field(default=None, ge=-180, le=180)


class ResolveOut(BaseModel):
    name: str | None
    lat: float | None
    lon: float | None
    url: str
    #: "link" when the coordinates were in the URL, "geocoded" when they
    #: were looked up from the name, null when there are none.
    position: Literal["link", "geocoded"] | None


@router.post("/resolve", response_model=ResolveOut)
# This endpoint makes an outbound request on demand, so it is capped: it
# must not become a way to have the server fetch things on someone's
# behalf. Sixty a minute is generous enough to work through an imported
# list of a hundred places in a couple of minutes, and still polite to
# Google — the client also spaces the calls out.
@limiter.limit("60/minute")
async def resolve_link(request: Request, payload: ResolveIn) -> MapsPlace:
    near = (
        (payload.near_lat, payload.near_lon)
        if payload.near_lat is not None and payload.near_lon is not None
        else None
    )
    return await maps.resolve(payload.url, near)
