"""Reading Google Maps links.

The parser is pure and gets the bulk of the attention; the network side is
covered for the cases that matter to security, which are the ones that can
be checked without a network.
"""

import pytest
from fastapi.testclient import TestClient

from app.errors import AppError
from app.services.maps import parse_maps_url, resolve


class TestParsing:
    def test_a_place_link_gives_name_and_coordinates(self) -> None:
        url = (
            "https://www.google.com/maps/place/Senso-ji/"
            "@35.7147651,139.7944013,17z/data=!3m1!4b1!4m6!3m5"
            "!1s0x60188ec8ba8b1f19:0x9b2a1d1e4b4e2f9c!8m2!3d35.7147651!4d139.7966553"
        )
        place = parse_maps_url(url)
        assert place.name == "Senso-ji"
        assert place.lat == pytest.approx(35.7147651)
        # The pin, not the viewport centre: those differ in the last decimals
        # and the pin is the one you actually want to walk to.
        assert place.lon == pytest.approx(139.7966553)

    def test_it_falls_back_to_the_viewport_when_there_is_no_pin(self) -> None:
        url = "https://www.google.com/maps/place/Shibuya/@35.6595,139.7005,15z"
        place = parse_maps_url(url)
        assert place.name == "Shibuya"
        assert place.lat == pytest.approx(35.6595)
        assert place.lon == pytest.approx(139.7005)

    def test_plus_signs_in_a_name_become_spaces(self) -> None:
        url = "https://www.google.com/maps/place/Tokyo+Skytree/@35.7101,139.8107,17z"
        assert parse_maps_url(url).name == "Tokyo Skytree"

    def test_a_percent_encoded_name_is_decoded(self) -> None:
        url = "https://www.google.com/maps/place/%E6%B5%85%E8%8D%89%E5%AF%BA/@35.71,139.79,17z"
        assert parse_maps_url(url).name == "浅草寺"

    def test_a_search_query_link(self) -> None:
        url = "https://www.google.com/maps/search/?api=1&query=35.7147,139.7966"
        place = parse_maps_url(url)
        assert place.lat == pytest.approx(35.7147)
        assert place.name is None

    def test_a_named_search_query(self) -> None:
        url = "https://www.google.com/maps/search/?api=1&query=Nezu+Museum"
        assert parse_maps_url(url).name == "Nezu Museum"

    def test_coordinates_are_never_mistaken_for_a_name(self) -> None:
        url = "https://www.google.com/maps/search/?api=1&query=35.7147,139.7966"
        assert parse_maps_url(url).name is None

    def test_impossible_coordinates_are_ignored(self) -> None:
        # 999 is not a latitude; better to return nothing than nonsense that
        # would later be drawn on a map.
        url = "https://www.google.com/maps/place/Nowhere/@999.0,139.7,17z"
        place = parse_maps_url(url)
        assert place.lat is None
        assert place.name == "Nowhere"

    def test_a_short_link_yields_nothing_on_its_own(self) -> None:
        place = parse_maps_url("https://maps.app.goo.gl/aBcDeFgHiJkL")
        assert place.lat is None and place.name is None

    def test_negative_coordinates(self) -> None:
        url = "https://www.google.com/maps/place/Ushuaia/@-54.8019,-68.3030,13z"
        place = parse_maps_url(url)
        assert place.lat == pytest.approx(-54.8019)
        assert place.lon == pytest.approx(-68.3030)


class TestHostChecks:
    """The security-relevant half: the server fetches a URL the client chose."""

    @pytest.mark.anyio
    async def test_a_non_google_host_is_refused_without_being_fetched(self) -> None:
        for url in (
            "https://evil.example.com/maps/place/x/@1,2,3z",
            "http://169.254.169.254/latest/meta-data/",
            "https://google.com.evil.example.com/",
            "file:///etc/passwd",
        ):
            with pytest.raises(AppError) as raised:
                await resolve(url)
            assert raised.value.code in {"not_a_maps_link", "invalid_url"}

    @pytest.mark.anyio
    async def test_a_country_domain_is_accepted(self) -> None:
        # google.it and friends are real Maps hosts; a link with coordinates
        # already in it resolves without any request going out.
        place = await resolve("https://www.google.it/maps/place/Duomo/@45.4642,9.1900,17z")
        assert place.name == "Duomo"
        assert place.lat == pytest.approx(45.4642)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def test_the_endpoint_reads_a_link(client: TestClient) -> None:
    response = client.post(
        "/api/maps/resolve",
        json={"url": "https://www.google.com/maps/place/Senso-ji/@35.7147,139.7966,17z"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Senso-ji"
    assert response.json()["lat"] == pytest.approx(35.7147)


def test_the_endpoint_refuses_a_foreign_host(client: TestClient) -> None:
    response = client.post("/api/maps/resolve", json={"url": "https://example.com/x"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "not_a_maps_link"
