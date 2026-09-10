"""Daily forecast, from Open-Meteo.

Free, no key, no account, no card — the same test every dependency in this
project has to pass.

Two things about a forecast shape the whole design. It only reaches about
two weeks ahead, so for a trip still being planned there is usually no
forecast at all; and it is a forecast, so it is worth less the further out
it goes. Both have to be said out loud rather than papered over: a screen
that silently shows nothing for a trip in October is indistinguishable
from one that is broken.

One request per stop, using the IANA zone we already store for it. Asking
Open-Meteo to guess the zone would work, but "which day did it rain on" is
exactly the kind of question this app answers from its own timezone data
rather than someone else's guess.
"""

import asyncio
import datetime as dt
from dataclasses import dataclass

import httpx

_BASE = "https://api.open-meteo.com/v1/forecast"
_TIMEOUT_SECONDS = 8.0

#: How far ahead the free forecast reaches, counting today.
#:
#: Checked against the live service on 10 September 2026: today + 15 is
#: accepted and today + 16 is refused outright, with "start_date is out of
#: allowed range". Refusing is the honest behaviour, but it refuses the
#: *whole* request — so one day too many costs you the fortnight that was
#: available. Hence the limit is enforced here rather than discovered.
FORECAST_DAYS = 16

#: Asked for by name so the response columns are predictable.
_DAILY_FIELDS = (
    "weather_code",
    "precipitation_sum",
    "precipitation_probability_max",
    "temperature_2m_max",
    "temperature_2m_min",
)


@dataclass(frozen=True)
class DayWeather:
    day: dt.date
    #: WMO code. The frontend turns it into words and an icon; storing the
    #: number keeps this layer free of anything translated.
    weather_code: int
    precipitation_mm: float
    #: Absent on some days at the edge of the range.
    precipitation_probability: int | None
    temp_max: float | None
    temp_min: float | None


@dataclass(frozen=True)
class StopForecast:
    stop_id: str
    days: list[DayWeather]


def horizon(today: dt.date) -> dt.date:
    """The last day a forecast can be had for."""
    return today + dt.timedelta(days=FORECAST_DAYS - 1)


def coverable(
    first: dt.date | None, last: dt.date | None, today: dt.date
) -> tuple[dt.date, dt.date] | None:
    """The part of a date range a forecast can actually speak about.

    Yesterday is not a forecast and next March is not either. Returns None
    when nothing in the range is reachable, which is the normal state of a
    trip that is still months away.
    """
    if first is None or last is None or last < first:
        return None
    start = max(first, today)
    end = min(last, horizon(today))
    return (start, end) if start <= end else None


def _parse(payload: dict) -> list[DayWeather]:
    daily = payload.get("daily") or {}
    days = daily.get("time") or []

    def column(name: str) -> list:
        values = daily.get(name) or []
        # Pad rather than zip: a short column would otherwise silently
        # truncate the days, and a missing Thursday is worse than a
        # Thursday with no temperature on it.
        return list(values) + [None] * (len(days) - len(values))

    codes = column("weather_code")
    precipitation = column("precipitation_sum")
    probability = column("precipitation_probability_max")
    highs = column("temperature_2m_max")
    lows = column("temperature_2m_min")

    parsed = []
    for index, day in enumerate(days):
        parsed.append(
            DayWeather(
                day=dt.date.fromisoformat(day),
                weather_code=int(codes[index] or 0),
                # No rain and no reading are different things, but only one
                # of them can be plotted; treating a gap as dry is stated
                # here rather than hidden in the caller.
                precipitation_mm=float(precipitation[index] or 0.0),
                precipitation_probability=(
                    None if probability[index] is None else int(probability[index])
                ),
                temp_max=None if highs[index] is None else float(highs[index]),
                temp_min=None if lows[index] is None else float(lows[index]),
            )
        )
    return parsed


async def _one(
    client: httpx.AsyncClient,
    *,
    stop_id: str,
    lat: float,
    lon: float,
    tz: str,
    start: dt.date,
    end: dt.date,
) -> StopForecast | None:
    """One stop's forecast, or None if it could not be had.

    None rather than an exception: a trip with four cities should still
    show the three that answered. Which ones failed is reported to the
    caller, so the screen can say so instead of quietly drawing less.
    """
    try:
        response = await client.get(
            _BASE,
            params={
                "latitude": lat,
                "longitude": lon,
                "daily": ",".join(_DAILY_FIELDS),
                "timezone": tz,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
            },
        )
        response.raise_for_status()
        return StopForecast(stop_id=stop_id, days=_parse(response.json()))
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None


@dataclass(frozen=True)
class Located:
    """A stop that can actually be forecast: it has coordinates and dates."""

    stop_id: str
    lat: float
    lon: float
    tz: str
    start: dt.date
    end: dt.date


async def fetch(stops: list[Located]) -> tuple[list[StopForecast], list[str]]:
    """Forecasts for several stops, and the ids of the ones that failed."""
    if not stops:
        return [], []

    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        # Together rather than in turn: four cities in sequence against a
        # sleeping free instance is four timeouts stacked end to end.
        results = await asyncio.gather(
            *(
                _one(
                    client,
                    stop_id=stop.stop_id,
                    lat=stop.lat,
                    lon=stop.lon,
                    tz=stop.tz,
                    start=stop.start,
                    end=stop.end,
                )
                for stop in stops
            )
        )

    found = [result for result in results if result is not None]
    missing = [stop.stop_id for stop, result in zip(stops, results, strict=True) if result is None]
    return found, missing
