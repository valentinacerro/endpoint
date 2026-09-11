import uuid
from typing import Annotated

from fastapi import APIRouter, File, UploadFile, status
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import select

from app.deps import DbSession
from app.enums import PlaceCategory, Priority, default_exposure
from app.errors import AppError
from app.models import Place, Stop, Trip
from app.schemas.place import PlaceCreate, PlaceRead, PlaceUpdate
from app.services import takeout
from app.services.lookup import apply_update, child_of_trip, get_or_404
from app.services.maps import parse_maps_url

router = APIRouter(prefix="/api/trips/{trip_id}/places", tags=["places"])


@router.get("", response_model=list[PlaceRead])
def list_places(trip_id: uuid.UUID, db: DbSession) -> list[Place]:
    get_or_404(db, Trip, trip_id)
    return list(db.scalars(select(Place).where(Place.trip_id == trip_id).order_by(Place.name)))


@router.post("", response_model=PlaceRead, status_code=status.HTTP_201_CREATED)
def create_place(trip_id: uuid.UUID, payload: PlaceCreate, db: DbSession) -> Place:
    get_or_404(db, Trip, trip_id)
    if payload.stop_id is not None:
        child_of_trip(db, Stop, payload.stop_id, trip_id)

    place = Place(trip_id=trip_id, **payload.model_dump())
    db.add(place)
    db.commit()
    return place


class ImportSummary(BaseModel):
    created: int
    with_position: int
    without_position: int
    skipped: int
    #: How many saved lists the upload turned out to contain. One for a
    #: single CSV; however many the archive held for a whole export.
    lists: int


# Declared before "/{place_id}" so "import" is never read as an id.
@router.post("/import", response_model=ImportSummary)
def import_from_takeout(
    trip_id: uuid.UUID,
    db: DbSession,
    file: Annotated[UploadFile, File()],
) -> ImportSummary:
    """Bulk-create places from a Google Takeout export.

    Takes the whole archive as downloaded, or a single CSV out of one.
    The archive is the point: making someone unpack a zip and upload a
    file per list is most of why that export is such a miserable way to
    move places, and it is ceremony this can simply absorb.

    Coordinates are read from each row's link **offline**. Many Takeout URLs
    carry only a place id and no position, and resolving those means one
    HTTP redirect each — a few hundred of them inside a single request would
    take minutes and hammer Google. Those places are created without a
    position and the app offers to fill them in afterwards, a few at a time.
    """
    get_or_404(db, Trip, trip_id)

    sheets = takeout.parse_export(file.file.read(), file.filename or "")

    # Re-importing the same list should not double every entry.
    existing = {
        name.strip().casefold()
        for name in db.scalars(select(Place.name).where(Place.trip_id == trip_id))
    }

    created = with_position = skipped = 0
    for row in (row for sheet in sheets for row in sheet.rows):
        if row.name.strip().casefold() in existing:
            skipped += 1
            continue
        existing.add(row.name.strip().casefold())

        found = parse_maps_url(row.url) if row.url else None
        place = Place(
            trip_id=trip_id,
            name=row.name,
            category=PlaceCategory.SIGHT,
            priority=Priority.NORMAL,
            weather_exposure=default_exposure(PlaceCategory.SIGHT),
            url=row.url,
            notes=row.note,
            lat=found.lat if found else None,
            lon=found.lon if found else None,
        )
        db.add(place)
        created += 1
        if place.lat is not None:
            with_position += 1

    db.commit()
    return ImportSummary(
        created=created,
        with_position=with_position,
        without_position=created - with_position,
        skipped=skipped,
        lists=len(sheets),
    )


class ScheduleEntry(BaseModel):
    id: uuid.UUID
    # AwareDatetime and a required zone, matching the PATCH route and the
    # database CHECK: an instant with no zone cannot be displayed.
    planned_start_at: AwareDatetime
    planned_tz: str = Field(min_length=1, max_length=64)


class ScheduleRequest(BaseModel):
    """A whole trip's worth of scheduling, in one go."""

    # A fortnight of sightseeing is tens of places, not thousands. The cap
    # bounds the work one request can ask for.
    scheduled: list[ScheduleEntry] = Field(default_factory=list, max_length=500)
    #: Returned to the wish list: planned somewhere that no longer holds.
    cleared: list[uuid.UUID] = Field(default_factory=list, max_length=500)


class ScheduleSummary(BaseModel):
    scheduled: int
    cleared: int


# Declared before "/{place_id}", or "schedule" is read as an id.
@router.post("/schedule", response_model=ScheduleSummary)
def schedule_places(trip_id: uuid.UUID, payload: ScheduleRequest, db: DbSession) -> ScheduleSummary:
    """Move many places at once, or none of them.

    The day planner writes thirty of these. As separate PATCHes that was
    thirty round trips against a service that can take a minute to wake,
    and — because each one invalidates the trip — sixty refetches. It was
    also not atomic: a connection dropping halfway left the itinerary
    half rearranged, with no way to tell which half.

    Everything is checked before anything is written, so a single id
    belonging to another trip refuses the whole request rather than
    applying most of it.
    """
    get_or_404(db, Trip, trip_id)

    wanted = [entry.id for entry in payload.scheduled] + list(payload.cleared)
    if len(set(wanted)) != len(wanted):
        raise AppError(
            "place_listed_twice",
            "The same place appears more than once in one request",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )

    found = {
        place.id: place
        for place in db.scalars(select(Place).where(Place.trip_id == trip_id, Place.id.in_(wanted)))
    }
    missing = [str(place_id) for place_id in wanted if place_id not in found]
    if missing:
        raise AppError(
            "place_not_found",
            f"{len(missing)} of those places are not on this trip",
            status_code=404,
        )

    for entry in payload.scheduled:
        place = found[entry.id]
        place.planned_start_at = entry.planned_start_at
        place.planned_tz = entry.planned_tz

    for place_id in payload.cleared:
        place = found[place_id]
        place.planned_start_at = None
        place.planned_tz = None

    db.commit()
    return ScheduleSummary(scheduled=len(payload.scheduled), cleared=len(payload.cleared))


@router.get("/{place_id}", response_model=PlaceRead)
def read_place(trip_id: uuid.UUID, place_id: uuid.UUID, db: DbSession) -> Place:
    return child_of_trip(db, Place, place_id, trip_id)


@router.patch("/{place_id}", response_model=PlaceRead)
def update_place(
    trip_id: uuid.UUID, place_id: uuid.UUID, payload: PlaceUpdate, db: DbSession
) -> Place:
    place = child_of_trip(db, Place, place_id, trip_id)
    if "stop_id" in payload.model_fields_set and payload.stop_id is not None:
        child_of_trip(db, Stop, payload.stop_id, trip_id)

    apply_update(place, payload)

    # Checked against the merged result, not the payload: scheduling a place
    # that already has a zone stored is a legitimate one-field update.
    if place.planned_start_at is not None and not place.planned_tz:
        raise AppError(
            "invalid_time_fields",
            "planned_tz is required when planned_start_at is set",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            field="planned_tz",
        )

    db.commit()
    return place


@router.delete("/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_place(trip_id: uuid.UUID, place_id: uuid.UUID, db: DbSession) -> None:
    place = child_of_trip(db, Place, place_id, trip_id)
    db.delete(place)
    db.commit()
