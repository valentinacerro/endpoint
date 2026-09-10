import uuid

from fastapi import APIRouter, Request, Response, status

from app.deps import DbSession
from app.models import Trip
from app.schemas.bundle import TripBundle
from app.services import bundle as bundle_service
from app.services.lookup import get_or_404

router = APIRouter(prefix="/api/trips/{trip_id}", tags=["bundle"])


def _matches(if_none_match: str | None, etag: str) -> bool:
    """Compare against an If-None-Match header.

    The header may carry several tags and a weak `W/` prefix, so a plain
    string equality check would miss valid matches and re-send the whole
    bundle for nothing.
    """
    if not if_none_match:
        return False
    if if_none_match.strip() == "*":
        return True
    candidates = (tag.strip() for tag in if_none_match.split(","))
    return any(tag.removeprefix("W/") == etag for tag in candidates)


@router.get("/bundle", response_model=TripBundle)
def read_bundle(trip_id: uuid.UUID, request: Request, response: Response, db: DbSession):
    trip = get_or_404(db, Trip, trip_id)
    etag = bundle_service.compute_etag(db, trip)

    if _matches(request.headers.get("if-none-match"), etag):
        # Nothing changed: an empty 304 instead of the whole trip. On hotel
        # wifi or a metered eSIM that is the difference worth having.
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})

    response.headers["ETag"] = etag
    # The bundle is the offline archive, so it must always be revalidated
    # rather than served stale from an HTTP cache we do not control.
    response.headers["Cache-Control"] = "private, no-cache"
    return bundle_service.build(db, trip)
