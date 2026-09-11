"""Looking a place up by typing its name.

The parsing and the classification are pure and get the attention. The
network side is checked for the cases that decide whether a search box
is usable: a service that is slow or wrong must not break the screen
someone is typing into.
"""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.enums import PlaceCategory
from app.services import geocode


def feature(**props) -> dict:
    coords = props.pop("coords", [139.7955, 35.7134])
    return {"type": "Feature", "properties": props, "geometry": {"coordinates": coords}}


class TestClassifying:
    @pytest.mark.parametrize(
        ("key", "value", "expected"),
        [
            ("tourism", "museum", PlaceCategory.MUSEUM),
            ("leisure", "park", PlaceCategory.PARK),
            ("leisure", "garden", PlaceCategory.GARDEN),
            ("amenity", "restaurant", PlaceCategory.FOOD),
            ("amenity", "cafe", PlaceCategory.FOOD),
            ("natural", "volcano", PlaceCategory.VIEWPOINT),
            ("shop", "books", PlaceCategory.SHOPPING),
            ("shop", "anything_at_all", PlaceCategory.SHOPPING),
        ],
    )
    def test_it_reads_the_obvious_ones(self, key, value, expected) -> None:
        assert geocode.categorise(key, value) == expected

    def test_it_tells_a_shrine_from_a_temple_when_osm_does(self) -> None:
        """The one distinction worth getting right on this trip, and the
        only way to get it: `place_of_worship` alone does not say."""
        assert geocode.categorise("building", "shrine") == PlaceCategory.SHRINE
        assert geocode.categorise("building", "temple") == PlaceCategory.TEMPLE

    def test_it_does_not_guess_between_a_temple_and_a_church(self) -> None:
        # A wrong category costs noticing and undoing; the neutral one
        # costs a single tap.
        assert geocode.categorise("amenity", "place_of_worship") == PlaceCategory.SIGHT

    def test_an_unknown_tag_falls_back_rather_than_failing(self) -> None:
        assert geocode.categorise("boundary", "administrative") == PlaceCategory.SIGHT
        assert geocode.categorise(None, None) == PlaceCategory.SIGHT


class TestParsing:
    def test_it_reads_a_result(self) -> None:
        hits = geocode.parse(
            {
                "features": [
                    feature(
                        name="Senso-ji Main Hall",
                        city="Taito City",
                        state="Tokyo",
                        country="Japan",
                        street="Nakamise Street",
                        housenumber="1",
                        osm_key="building",
                        osm_value="shrine",
                    )
                ]
            }
        )
        assert hits == [
            geocode.Hit(
                name="Senso-ji Main Hall",
                lat=35.7134,
                lon=139.7955,
                where="Taito City, Tokyo, Japan",
                address="Nakamise Street 1",
                category=PlaceCategory.SHRINE,
            )
        ]

    def test_it_does_not_repeat_a_place_name_in_its_own_context(self) -> None:
        # Tokyo the city inside Tokyo the prefecture would read
        # "Tokyo, Tokyo, Japan".
        hits = geocode.parse(
            {"features": [feature(name="Somewhere", city="Tokyo", state="Tokyo", country="Japan")]}
        )
        assert hits[0].where == "Tokyo, Japan"

    def test_a_result_with_no_name_is_dropped(self) -> None:
        """Streets and postcodes are real to a geocoder and useless as
        somewhere to visit."""
        hits = geocode.parse({"features": [feature(city="Tokyo", osm_key="place")]})
        assert hits == []

    def test_coordinates_outside_the_world_are_dropped(self) -> None:
        hits = geocode.parse({"features": [feature(name="Nowhere", coords=[999, 999])]})
        assert hits == []

    def test_a_result_with_no_street_has_no_address(self) -> None:
        hits = geocode.parse({"features": [feature(name="Mount Fuji", country="Japan")]})
        assert hits[0].address is None

    def test_it_stops_at_a_readable_number_of_suggestions(self) -> None:
        many = {"features": [feature(name=f"Place {n}") for n in range(50)]}
        assert len(geocode.parse(many)) == geocode.MAX_RESULTS

    def test_an_empty_answer_is_not_an_error(self) -> None:
        assert geocode.parse({"features": []}) == []
        assert geocode.parse({}) == []


class TestSearching:
    @pytest.mark.anyio
    async def test_it_biases_towards_where_you_are(self) -> None:
        """The difference between useful and not: unbiased, "ichiran
        ramen" offers Hong Kong first."""
        seen: dict[str, str] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen.update(dict(request.url.params))
            return httpx.Response(200, json={"features": []})

        async with _client(handler) as http:
            await geocode.ask(http, "ichiran ramen", (35.6896, 139.7006))

        assert seen["lat"] == "35.6896"
        assert seen["lon"] == "139.7006"

    @pytest.mark.anyio
    async def test_it_asks_for_readable_names(self) -> None:
        # Without this the answer for Japan comes back as 浅草寺.
        seen: dict[str, str] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen.update(dict(request.url.params))
            return httpx.Response(200, json={"features": []})

        async with _client(handler) as http:
            await geocode.ask(http, "senso-ji")

        assert seen["lang"] == "en"
        assert "lat" not in seen

    @pytest.mark.anyio
    async def test_a_failure_is_an_empty_list_not_an_error(self) -> None:
        """A search box that throws while you are still typing is worse
        than one that finds nothing for a moment."""

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, text="busy")

        async with _client(handler) as http:
            assert await geocode.ask(http, "senso-ji") == []

    @pytest.mark.anyio
    async def test_nonsense_in_the_body_is_not_an_error(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b"not json")

        async with _client(handler) as http:
            assert await geocode.ask(http, "senso-ji") == []


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class TestTheEndpoint:
    def test_it_answers_with_suggestions(self, client: TestClient, monkeypatch) -> None:
        async def fake(query: str, near):
            return [
                geocode.Hit(
                    name="Senso-ji",
                    lat=35.7134,
                    lon=139.7955,
                    where="Tokyo, Japan",
                    address=None,
                    category=PlaceCategory.TEMPLE,
                )
            ]

        monkeypatch.setattr(geocode, "search", fake)
        body = client.get("/api/geo/search", params={"q": "senso"}).json()

        assert body[0]["name"] == "Senso-ji"
        assert body[0]["category"] == "temple"

    def test_a_query_of_one_letter_is_refused(self, client: TestClient) -> None:
        # Every letter typed is a request to somebody else's free
        # service; one-letter searches are noise in both directions.
        assert client.get("/api/geo/search", params={"q": "s"}).status_code == 422

    def test_coordinates_outside_the_world_are_refused(self, client: TestClient) -> None:
        response = client.get("/api/geo/search", params={"q": "senso", "lat": 200, "lon": 0})
        assert response.status_code == 422
