import datetime as dt
import uuid

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import DbSession
from app.limiter import limiter
from app.models import Stop, Trip
from app.services import weather
from app.services.lookup import get_or_404

router = APIRouter(prefix="/api/trips/{trip_id}/weather", tags=["weather"])


class DayWeatherOut(BaseModel):
    stop_id: uuid.UUID
    day: dt.date
    weather_code: int
    precipitation_mm: float
    precipitation_probability: int | None
    temp_max: float | None
    temp_min: float | None


class WeatherOut(BaseModel):
    """What could be forecast, and — just as important — what could not.

    Three separate reasons a day can be missing, kept apart because they
    call for different answers from the reader: the trip is too far off,
    a stop has no coordinates yet, or the service did not respond.
    """

    days: list[DayWeatherOut]
    #: Trip days no forecast reaches, either past or beyond the horizon.
    beyond_forecast: list[dt.date]
    #: Stops with no coordinates, so nothing can be asked about them.
    unlocated_stops: list[uuid.UUID]
    #: Stops that have coordinates but whose forecast did not arrive.
    unavailable_stops: list[uuid.UUID]
    #: The last day any forecast can speak about.
    horizon: dt.date
    fetched_at: dt.datetime


def _span(stop: Stop, trip: Trip) -> tuple[dt.date | None, dt.date | None]:
    """The days you are at this stop.

    A stop with no dates of its own falls back to the whole trip: better
    to forecast a few days too many than to say nothing about a city you
    are definitely visiting.
    """
    first = stop.arrive_date or trip.start_date
    last = stop.depart_date or stop.arrive_date or trip.end_date
    return first, last


@router.get("", response_model=WeatherOut)
@limiter.limit("30/minute")
async def get_weather(request: Request, trip_id: uuid.UUID, db: DbSession) -> WeatherOut:
    """The forecast for each stop, over the days you are there.

    Not part of the trip bundle on purpose. The bundle is your data, with
    an ETag built from when you last changed it; a forecast is someone
    else's data that changes on its own several times a day. Mixing them
    would mean either a bundle that never validates or a forecast that
    goes stale silently.
    """
    trip = get_or_404(db, Trip, trip_id)
    today = dt.datetime.now(dt.UTC).date()
    stops = list(db.scalars(select(Stop).where(Stop.trip_id == trip_id).order_by(Stop.position)))

    located: list[weather.Located] = []
    unlocated: list[uuid.UUID] = []

    for stop in stops:
        if stop.lat is None or stop.lon is None:
            unlocated.append(stop.id)
            continue
        first, last = _span(stop, trip)
        window = weather.coverable(first, last, today)
        if window is None:
            continue
        located.append(
            weather.Located(
                stop_id=str(stop.id),
                lat=stop.lat,
                lon=stop.lon,
                tz=stop.tz,
                start=window[0],
                end=window[1],
            )
        )

    forecasts, missing = await weather.fetch(located)

    days = [
        DayWeatherOut(
            stop_id=uuid.UUID(forecast.stop_id),
            day=day.day,
            weather_code=day.weather_code,
            precipitation_mm=day.precipitation_mm,
            precipitation_probability=day.precipitation_probability,
            temp_max=day.temp_max,
            temp_min=day.temp_min,
        )
        for forecast in forecasts
        for day in forecast.days
    ]

    return WeatherOut(
        days=days,
        beyond_forecast=_unreachable(trip, today),
        unlocated_stops=unlocated,
        unavailable_stops=[uuid.UUID(stop_id) for stop_id in missing],
        horizon=weather.horizon(today),
        fetched_at=dt.datetime.now(dt.UTC),
    )


def _unreachable(trip: Trip, today: dt.date) -> list[dt.date]:
    """Trip days outside the forecast window.

    Listed rather than counted so the screen can mark the exact days it
    knows nothing about, instead of a footnote the reader has to apply
    themselves.
    """
    if trip.start_date is None or trip.end_date is None:
        return []
    limit = weather.horizon(today)
    span = (trip.end_date - trip.start_date).days
    every = (trip.start_date + dt.timedelta(days=offset) for offset in range(span + 1))
    return [day for day in every if day < today or day > limit]
