"""Finding places when the traveller brought none of their own.

The parsing and the ranking get the attention, because they are what
decides whether the list is useful. The network side is covered for the
one thing that matters operationally: Overpass is a volunteer service and
falls over regularly, and none of that may reach the screen as an error.
"""

import httpx
import pytest

from app.enums import PlaceCategory
from app.services import discover


def node(**tags) -> dict:
    return {"type": "node", "id": tags.pop("id", 1), "lat": 35.71, "lon": 139.79, "tags": tags}


class TestParsing:
    def test_a_node_becomes_a_suggestion(self) -> None:
        found = discover.parse({"elements": [node(name="Senso-ji", tourism="attraction")]})
        assert len(found) == 1
        assert found[0].name == "Senso-ji"
        assert (found[0].lat, found[0].lon) == (pytest.approx(35.71), pytest.approx(139.79))
        assert found[0].osm_id == "node/1"

    def test_a_way_uses_the_computed_centre(self) -> None:
        # A park is an area, so it has no position of its own; `out center`
        # is what supplies one, and reading `lat` off the element would
        # quietly drop every park and garden.
        payload = {
            "elements": [
                {
                    "type": "way",
                    "id": 7,
                    "center": {"lat": 35.6852, "lon": 139.7528},
                    "tags": {"name": "Hibiya Park", "leisure": "park"},
                }
            ]
        }
        found = discover.parse(payload)
        assert found[0].lat == pytest.approx(35.6852)
        assert found[0].osm_id == "way/7"

    def test_english_name_wins_where_there_is_one(self) -> None:
        # "Senso-ji" on a screen read in a hurry beats 浅草寺.
        tags = {"name": "浅草寺", "name:en": "Senso-ji", "tourism": "attraction"}
        found = discover.parse({"elements": [node(**tags)]})
        assert found[0].name == "Senso-ji"

    def test_something_with_no_name_is_dropped(self) -> None:
        # A row reading "Attraction" helps nobody choose.
        assert discover.parse({"elements": [node(tourism="attraction")]}) == []

    def test_something_with_no_position_is_dropped(self) -> None:
        payload = {"elements": [{"type": "relation", "id": 3, "tags": {"name": "Somewhere"}}]}
        assert discover.parse(payload) == []

    def test_the_same_place_under_two_tags_appears_once(self) -> None:
        # A temple is routinely tagged both `amenity=place_of_worship` and
        # `historic=monument`, and the query asks for both.
        payload = {
            "elements": [
                node(id=1, name="Senso-ji", tourism="attraction", wikidata="Q185153"),
                node(id=2, name="Senso-ji", historic="monument", wikidata="Q185153"),
            ]
        }
        assert len(discover.parse(payload)) == 1

    def test_two_different_places_with_the_same_name_both_survive(self) -> None:
        payload = {
            "elements": [
                node(id=1, name="Inari Shrine", amenity="place_of_worship"),
                node(id=2, name="Inari Shrine", amenity="place_of_worship"),
            ]
        }
        assert len(discover.parse(payload)) == 2

    def test_the_category_comes_from_the_osm_tag(self) -> None:
        found = discover.parse({"elements": [node(name="Nezu Museum", tourism="museum")]})
        assert found[0].category == PlaceCategory.MUSEUM

    def test_a_tag_we_do_not_map_falls_back_rather_than_guessing(self) -> None:
        found = discover.parse({"elements": [node(name="Somewhere", historic="city_gate")]})
        assert found[0].category == PlaceCategory.SIGHT


class TestRanking:
    def test_the_better_known_comes_first(self) -> None:
        places = [
            discover.Suggestion("Local shrine", 0, 0, PlaceCategory.SHRINE, 0, None, "node/1"),
            discover.Suggestion("Tokyo Skytree", 0, 0, PlaceCategory.SIGHT, 72, "Q57965", "node/2"),
            discover.Suggestion(
                "Nezu Museum", 0, 0, PlaceCategory.MUSEUM, 2, "Q11526417", "node/3"
            ),
        ]
        assert [p.name for p in discover.rank(places)] == [
            "Tokyo Skytree",
            "Nezu Museum",
            "Local shrine",
        ]

    def test_the_unknown_are_ordered_by_name_rather_than_by_luck(self) -> None:
        # Most entries have no Wikidata link, so without this the order
        # below the famous ones is whatever Overpass emitted — which
        # changes between calls and reads as random.
        places = [
            discover.Suggestion(n, 0, 0, PlaceCategory.SIGHT, 0, None, f"node/{i}")
            for i, n in enumerate(["Zojo-ji", "asakusa", "Meguro"])
        ]
        assert [p.name for p in discover.rank(places)] == ["asakusa", "Meguro", "Zojo-ji"]


class TestTheBoundingBox:
    def test_it_widens_with_latitude(self) -> None:
        # A degree of longitude is 111 km at the equator and half that in
        # Iceland; a box that ignored this would be a thin sliver up north.
        equator = discover._bbox(0.0, 0.0, 10.0)
        north = discover._bbox(64.0, 0.0, 10.0)

        def width(box: str) -> float:
            parts = box.strip("()").split(",")
            return float(parts[3]) - float(parts[1])

        assert width(north) > width(equator) * 2

    def test_it_does_not_divide_by_zero_at_the_pole(self) -> None:
        assert discover._bbox(90.0, 0.0, 10.0)


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class TestWhenTheServiceIsDown:
    """Overpass answered 504 twice and timed out once while this was being
    written. None of that may reach the screen as an error."""

    @pytest.mark.anyio
    async def test_it_tries_the_next_mirror(self) -> None:
        asked: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            asked.append(str(request.url))
            if len(asked) == 1:
                return httpx.Response(504, text="busy")
            return httpx.Response(200, json={"elements": []})

        async with _client(handler) as client:
            payload = await discover._overpass(client, "query")
        assert payload == {"elements": []}
        assert len(asked) == 2
        assert asked[0] != asked[1]

    @pytest.mark.anyio
    async def test_every_mirror_failing_is_silence_rather_than_an_error(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("timed out")

        async with _client(handler) as client:
            assert await discover._overpass(client, "query") is None

    @pytest.mark.anyio
    async def test_a_body_that_is_not_json_is_treated_as_a_failure(self) -> None:
        # A mirror in trouble answers 200 with an HTML error page.
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text="<html>overloaded</html>")

        async with _client(handler) as client:
            assert await discover._overpass(client, "query") is None


class TestFame:
    @staticmethod
    def _answer(counts: dict[str, int]) -> dict:
        return {
            "results": {
                "bindings": [
                    {
                        "item": {"value": f"http://www.wikidata.org/entity/{qid}"},
                        "links": {"value": str(n)},
                    }
                    for qid, n in counts.items()
                ]
            }
        }

    @pytest.mark.anyio
    async def test_it_counts_the_language_editions(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=TestFame._answer({"Q57965": 72, "Q1": 0}))

        async with _client(handler) as client:
            assert await discover.fame(client, ["Q57965", "Q1"]) == {"Q57965": 72, "Q1": 0}

    @pytest.mark.anyio
    async def test_a_person_is_absent_and_so_counts_as_nothing(self) -> None:
        # The statue trap: OSM puts the commemorated person's id on the
        # plaque. Wikidata is asked to leave people out, so the id simply
        # does not come back — and an absent id ranks as zero, which is
        # what a knee-high plaque deserves.
        def handler(request: httpx.Request) -> httpx.Response:
            assert "wd:Q5" in request.url.params["query"]
            return httpx.Response(200, json=TestFame._answer({"Q57965": 72}))

        async with _client(handler) as client:
            counts = await discover.fame(client, ["Q57965", "Q1067"])
        assert counts == {"Q57965": 72}
        assert counts.get("Q1067", 0) == 0

    @pytest.mark.anyio
    async def test_it_asks_in_batches(self) -> None:
        calls: list[int] = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request.url.params["query"].count("wd:Q") - 1)
            return httpx.Response(200, json=TestFame._answer({}))

        async with _client(handler) as client:
            await discover.fame(client, [f"Q{n}" for n in range(700)])
        assert calls == [300, 300, 100]

    @pytest.mark.anyio
    async def test_wikidata_being_down_leaves_the_list_unsorted_rather_than_empty(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(429, text="too many queries")

        async with _client(handler) as client:
            assert await discover.fame(client, ["Q57965"]) == {}


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class TestTheEndpoint:
    def test_it_answers_with_an_empty_list_when_overpass_is_down(self, client, monkeypatch) -> None:
        # The whole point: a volunteer service being unavailable is a
        # disappointment on screen, never a 502 from us.
        async def down(lat, lon, radius_km=8.0, limit=120):
            return []

        monkeypatch.setattr(discover, "around", down)
        response = client.get("/api/geo/discover", params={"lat": 35.7, "lon": 139.7})
        assert response.status_code == 200
        assert response.json() == []

    def test_it_passes_the_radius_through(self, client, monkeypatch) -> None:
        seen: dict = {}

        async def spy(lat, lon, radius_km=8.0, limit=120):
            seen.update(lat=lat, lon=lon, radius_km=radius_km)
            return [
                discover.Suggestion(
                    "Senso-ji", 35.71, 139.79, PlaceCategory.TEMPLE, 48, "Q185153", "node/1"
                )
            ]

        monkeypatch.setattr(discover, "around", spy)
        response = client.get(
            "/api/geo/discover", params={"lat": 35.7, "lon": 139.7, "radius_km": 3}
        )
        assert response.status_code == 200
        assert seen == {"lat": 35.7, "lon": 139.7, "radius_km": 3.0}
        assert response.json()[0]["name"] == "Senso-ji"
        assert response.json()[0]["fame"] == 48

    def test_an_impossible_radius_is_refused(self, client) -> None:
        response = client.get(
            "/api/geo/discover", params={"lat": 35.7, "lon": 139.7, "radius_km": 5000}
        )
        assert response.status_code == 422


class TestTellingATempleFromAShrine:
    """`amenity=place_of_worship` does not say which, and in Japan guessing
    is wrong about half the time. Only `building` separates them."""

    def test_a_temple_building_beats_the_attraction_tag(self) -> None:
        # Senso-ji carries all three tags at once.
        found = discover.parse(
            {
                "elements": [
                    node(
                        name="Senso-ji",
                        tourism="attraction",
                        amenity="place_of_worship",
                        building="temple",
                    )
                ]
            }
        )
        assert found[0].category == PlaceCategory.TEMPLE

    def test_a_shrine_building_is_a_shrine(self) -> None:
        shrine = node(name="Asakusa Shrine", amenity="place_of_worship", building="shrine")
        found = discover.parse({"elements": [shrine]})
        assert found[0].category == PlaceCategory.SHRINE

    def test_an_ordinary_building_tag_does_not_hijack_the_category(self) -> None:
        # Museums are tagged `building=yes`, which says nothing at all.
        found = discover.parse(
            {"elements": [node(name="Artizon Museum", tourism="museum", building="yes")]}
        )
        assert found[0].category == PlaceCategory.MUSEUM
