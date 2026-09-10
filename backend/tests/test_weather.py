"""The forecast, and the honesty about where it ends.

A forecast reaches about two weeks. A trip being planned is usually
further off than that, so "there is no forecast yet" is the *normal*
answer here, not an error — and most of these tests are about saying so
precisely rather than showing an empty screen.
"""

import datetime as dt
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.services import weather
from tests.factories import make_stop, make_trip

TODAY = dt.date(2026, 4, 10)


def day(offset: int) -> dt.date:
    return TODAY + dt.timedelta(days=offset)


class TestCoverable:
    def test_a_trip_inside_the_window_is_covered_whole(self) -> None:
        assert weather.coverable(day(2), day(5), TODAY) == (day(2), day(5))

    def test_a_trip_already_under_way_starts_from_today(self) -> None:
        """Yesterday is not a forecast. Asking for it makes Open-Meteo
        refuse the whole range, taking the useful days down with it."""
        assert weather.coverable(day(-3), day(4), TODAY) == (TODAY, day(4))

    def test_a_trip_running_past_the_horizon_is_cut_at_it(self) -> None:
        first, last = weather.coverable(day(10), day(40), TODAY)
        assert first == day(10)
        assert last == weather.horizon(TODAY)

    def test_a_trip_beyond_the_horizon_is_not_covered_at_all(self) -> None:
        """The usual state of a trip being planned, and the case that must
        produce a clear message instead of a blank screen."""
        assert weather.coverable(day(60), day(74), TODAY) is None

    def test_a_trip_entirely_in_the_past_is_not_covered(self) -> None:
        assert weather.coverable(day(-20), day(-6), TODAY) is None

    def test_a_stop_with_no_dates_is_not_covered(self) -> None:
        assert weather.coverable(None, day(3), TODAY) is None
        assert weather.coverable(day(3), None, TODAY) is None

    def test_a_backwards_range_is_refused_rather_than_inverted(self) -> None:
        assert weather.coverable(day(8), day(2), TODAY) is None

    def test_the_horizon_day_itself_is_included(self) -> None:
        limit = weather.horizon(TODAY)
        assert weather.coverable(limit, limit, TODAY) == (limit, limit)


class TestParsing:
    def test_it_reads_a_day(self) -> None:
        days = weather._parse(
            {
                "daily": {
                    "time": ["2026-04-12"],
                    "weather_code": [61],
                    "precipitation_sum": [7.4],
                    "precipitation_probability_max": [80],
                    "temperature_2m_max": [17.2],
                    "temperature_2m_min": [9.1],
                }
            }
        )
        assert days == [
            weather.DayWeather(
                day=dt.date(2026, 4, 12),
                weather_code=61,
                precipitation_mm=7.4,
                precipitation_probability=80,
                temp_max=17.2,
                temp_min=9.1,
            )
        ]

    def test_a_short_column_does_not_swallow_the_later_days(self) -> None:
        """The subtle one.

        Zipping the columns together would drop every day past the end of
        the shortest, so a probability series that stops early would make
        the last days of the trip vanish rather than merely lack a number.
        """
        days = weather._parse(
            {
                "daily": {
                    "time": ["2026-04-12", "2026-04-13", "2026-04-14"],
                    "weather_code": [1, 2, 3],
                    "precipitation_sum": [0, 1, 2],
                    "precipitation_probability_max": [10],
                    "temperature_2m_max": [17.0, 18.0, 19.0],
                    "temperature_2m_min": [9.0, 10.0, 11.0],
                }
            }
        )
        assert [entry.day.day for entry in days] == [12, 13, 14]
        assert [entry.precipitation_probability for entry in days] == [10, None, None]

    def test_a_missing_reading_is_none_and_not_zero(self) -> None:
        """A day with no temperature is not a day at zero degrees."""
        days = weather._parse(
            {
                "daily": {
                    "time": ["2026-04-12"],
                    "weather_code": [1],
                    "precipitation_sum": [0],
                    "precipitation_probability_max": [None],
                    "temperature_2m_max": [None],
                    "temperature_2m_min": [None],
                }
            }
        )
        assert days[0].precipitation_probability is None
        assert days[0].temp_max is None

    def test_an_empty_response_gives_no_days(self) -> None:
        assert weather._parse({}) == []


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


LOCATED = {
    "stop_id": "s1",
    "lat": 35.6,
    "lon": 139.7,
    "tz": "Asia/Tokyo",
    "start": day(1),
    "end": day(3),
}


class TestFetchingOneStop:
    @pytest.mark.anyio
    async def test_it_asks_for_the_stops_own_timezone(self) -> None:
        """Which day the rain falls on depends on where the day boundary
        is. We store the stop's IANA zone, so we send it rather than let
        the service guess from the coordinates."""
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen.update(dict(request.url.params))
            return httpx.Response(200, json={"daily": {"time": []}})

        async with _client(handler) as client:
            await weather._one(client, **LOCATED)

        assert seen["timezone"] == "Asia/Tokyo"
        assert seen["start_date"] == day(1).isoformat()
        assert seen["end_date"] == day(3).isoformat()

    @pytest.mark.anyio
    async def test_a_refusal_is_not_an_exception(self) -> None:
        """One city failing must not take the other three down with it."""

        async with _client(lambda request: httpx.Response(400, text="bad range")) as client:
            assert await weather._one(client, **LOCATED) is None

    @pytest.mark.anyio
    async def test_nonsense_in_the_body_is_not_an_exception(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b"not json at all")

        async with _client(handler) as client:
            assert await weather._one(client, **LOCATED) is None

    @pytest.mark.anyio
    async def test_a_day_that_is_not_a_date_is_not_an_exception(self) -> None:
        body = {"daily": {"time": ["the twelfth"], "weather_code": [1]}}

        async with _client(lambda request: httpx.Response(200, json=body)) as client:
            assert await weather._one(client, **LOCATED) is None


def _stub_forecast(
    monkeypatch, days: list[weather.DayWeather], missing: list[str] | None = None
) -> None:
    absent = missing or []

    async def fake(stops: list[weather.Located]):
        return [weather.StopForecast(stop_id=stop.stop_id, days=days) for stop in stops], absent

    monkeypatch.setattr(weather, "fetch", fake)


class TestTheEndpoint:
    def test_it_reports_the_days_no_forecast_reaches(
        self, client: TestClient, db_session: Session, monkeypatch
    ) -> None:
        """A trip two months out has no forecast, and the screen has to be
        able to say that rather than draw nothing."""
        today = dt.datetime.now(dt.UTC).date()
        trip = make_trip(
            db_session,
            start_date=today + dt.timedelta(days=60),
            end_date=today + dt.timedelta(days=62),
        )
        make_stop(db_session, trip, lat=35.6, lon=139.7, tz="Asia/Tokyo")
        _stub_forecast(monkeypatch, [])

        body = client.get(f"/api/trips/{trip.id}/weather").json()

        assert body["days"] == []
        assert len(body["beyond_forecast"]) == 3
        assert body["horizon"] == (today + dt.timedelta(days=15)).isoformat()

    def test_a_stop_with_no_coordinates_is_named_not_skipped(
        self, client: TestClient, db_session: Session, monkeypatch
    ) -> None:
        """Silently leaving a city out would read as "no rain in Kyoto"."""
        today = dt.datetime.now(dt.UTC).date()
        trip = make_trip(db_session, start_date=today, end_date=today + dt.timedelta(days=2))
        located = make_stop(db_session, trip, lat=35.6, lon=139.7, tz="Asia/Tokyo")
        blind = make_stop(db_session, trip, name="Kyoto", lat=None, lon=None, tz="Asia/Tokyo")
        _stub_forecast(
            monkeypatch,
            [
                weather.DayWeather(
                    day=today,
                    weather_code=61,
                    precipitation_mm=8.0,
                    precipitation_probability=90,
                    temp_max=16.0,
                    temp_min=8.0,
                )
            ],
        )

        body = client.get(f"/api/trips/{trip.id}/weather").json()

        assert body["unlocated_stops"] == [str(blind.id)]
        assert [entry["stop_id"] for entry in body["days"]] == [str(located.id)]

    def test_a_stop_whose_forecast_failed_is_named_too(
        self, client: TestClient, db_session: Session, monkeypatch
    ) -> None:
        today = dt.datetime.now(dt.UTC).date()
        trip = make_trip(db_session, start_date=today, end_date=today + dt.timedelta(days=1))
        stop = make_stop(db_session, trip, lat=35.6, lon=139.7, tz="Asia/Tokyo")
        _stub_forecast(monkeypatch, [], missing=[str(stop.id)])

        body = client.get(f"/api/trips/{trip.id}/weather").json()

        assert body["unavailable_stops"] == [str(stop.id)]

    def test_a_trip_that_is_not_there_says_so(self, client: TestClient) -> None:
        import uuid

        assert client.get(f"/api/trips/{uuid.uuid4()}/weather").status_code == 404

    def test_the_forecast_is_not_in_the_bundle(
        self, client: TestClient, db_session: Session
    ) -> None:
        """Deliberate. The bundle is your data, with an ETag from when you
        last changed it; a forecast changes several times a day on its
        own. One cache entry cannot honestly hold both."""
        trip = make_trip(db_session)
        bundle = client.get(f"/api/trips/{trip.id}/bundle").json()
        assert "weather" not in json.dumps(bundle)
