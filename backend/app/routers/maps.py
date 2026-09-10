from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.limiter import limiter
from app.services import maps
from app.services.maps import MapsPlace

router = APIRouter(prefix="/api/maps", tags=["maps"])


class ResolveIn(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class ResolveOut(BaseModel):
    name: str | None
    lat: float | None
    lon: float | None
    url: str


@router.post("/resolve", response_model=ResolveOut)
# This endpoint makes an outbound request on demand, so it is capped: it
# must not become a way to have the server fetch things on someone's
# behalf. Sixty a minute is generous enough to work through an imported
# list of a hundred places in a couple of minutes, and still polite to
# Google — the client also spaces the calls out.
@limiter.limit("60/minute")
async def resolve_link(request: Request, payload: ResolveIn) -> MapsPlace:
    return await maps.resolve(payload.url)
