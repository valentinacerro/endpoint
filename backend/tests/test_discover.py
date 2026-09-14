"""Finding places when the traveller brought none of their own.

The parsing and the ranking get the attention, because they are what
decides whether the list is useful. The network side is covered for the
one thing that matters operationally: Overpass is a volunteer service and
falls over regularly, and none of that may reach the screen as an error.
"""

import asyncio
import time
from urllib.parse import unquote_plus

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


async def _no_fame(client: httpx.AsyncClient, ids: list[str]) -> dict[str, int]:
    """Wikidata is a separate service and a separate question."""
    return {}


#: Captured before anything replaces the name: `_transport` stands in for
#: `httpx.AsyncClient`, and building one through the patched name would
#: call itself.
_REAL_CLIENT = httpx.AsyncClient


def _transport(handler):
    """An `httpx.AsyncClient` that answers from `handler`, whoever builds it."""

    def build(*args: object, **kwargs: object) -> httpx.AsyncClient:
        return _REAL_CLIENT(transport=httpx.MockTransport(handler))

    return build


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class TestWhenTheServiceIsDown:
    """Overpass answered 504 twice and timed out once while this was being
    written. None of that may reach the screen as an error."""

    @pytest.mark.anyio
    async def test_a_busy_instance_is_asked_again_before_being_given_up_on(self) -> None:
        """Measured: 504, 504, then 200 in 1.1 seconds.

        Overload here is a queue and not an outage, so the same instance a
        second later is a better bet than a different one — and the list of
        different ones is short, because most of the mirrors are dead.
        """
        asked: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            asked.append(str(request.url))
            if len(asked) == 1:
                return httpx.Response(504, text="busy")
            return httpx.Response(200, json={"elements": []})

        async with _client(handler) as client:
            payload = await discover._overpass(client, "query")
        assert payload == {"elements": []}
        assert asked == [asked[0], asked[0]]

    @pytest.mark.anyio
    async def test_an_instance_that_stays_busy_hands_over_to_the_next(self) -> None:
        asked: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            asked.append(str(request.url))
            if str(request.url) == discover._OVERPASS[0]:
                return httpx.Response(504, text="busy")
            return httpx.Response(200, json={"elements": []})

        async with _client(handler) as client:
            payload = await discover._overpass(client, "query")
        assert payload == {"elements": []}
        # Twice to the first, then on to the second.
        assert asked == [discover._OVERPASS[0], discover._OVERPASS[0], discover._OVERPASS[1]]

    @pytest.mark.anyio
    async def test_a_refused_query_is_not_asked_twice(self) -> None:
        """A 400 is about the query and will be a 400 again.

        Asking a second time would double the load we put on a service run
        on donations, to be told the same thing.
        """
        asked: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            asked.append(str(request.url))
            return httpx.Response(400, text="bad query")

        async with _client(handler) as client:
            assert await discover._overpass(client, "query") is None
        assert asked == list(discover._OVERPASS)

    def test_no_mirror_answers_only_for_one_country(self) -> None:
        """`overpass.osm.ch` is the fastest instance measured and is not here.

        It answers 200 with an empty list for anywhere outside Switzerland,
        which this code cannot tell apart from "there is nothing in Tokyo".
        A mirror that fails is recoverable; one that lies quietly is not.
        """
        assert not any("osm.ch" in url for url in discover._OVERPASS)

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


class TestAskingAgainWhereWikidataDoesNotReach:
    """The whole reason an itinerary could not be made outside Europe.

    The narrow query asks only for objects carrying a `wikidata` tag,
    because that tag is what makes a place rankable. Measured on a 5 km
    box: Tokyo 711 such objects, Marrakech 13, Bariloche 2, Nairobi and
    Kathmandu none at all — against 107, 95, 645 and 1160 without the
    requirement. The places are there; the curation is not.
    """

    @staticmethod
    def _payload(count: int, *, wikidata: bool, first_id: int = 1) -> dict:
        return {
            "elements": [
                {
                    "type": "node",
                    "id": first_id + i,
                    "lat": 35.0 + i / 1000,
                    "lon": 139.0 + i / 1000,
                    "tags": {
                        "name": f"Place {first_id + i}",
                        "tourism": "attraction",
                        **({"wikidata": f"Q{first_id + i}"} if wikidata else {}),
                    },
                }
                for i in range(count)
            ]
        }

    @pytest.mark.anyio
    async def test_a_thin_answer_is_asked_again_without_the_requirement(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        asked: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            # Form-encoded on the wire, so the tag reads as %22wikidata%22.
            query = unquote_plus(request.content.decode())
            asked.append(query)
            if "wikidata" in query:
                return httpx.Response(200, json=self._payload(2, wikidata=True))
            return httpx.Response(200, json=self._payload(40, wikidata=False, first_id=100))

        monkeypatch.setattr(discover, "fame", _no_fame)
        monkeypatch.setattr(httpx, "AsyncClient", _transport(handler))
        found = await discover.around(-41.13, -71.31, 5.0)

        assert len(asked) == 2
        assert '["wikidata"]' in asked[0]
        assert '["wikidata"]' not in asked[1]
        # Both halves, and the two rankable ones kept.
        assert len(found) == 42

    @pytest.mark.anyio
    async def test_a_city_that_answers_richly_is_asked_once(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Nothing extra is asked of a service run on donations when the
        # first answer was good enough.
        asked: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            asked.append(unquote_plus(request.content.decode()))
            return httpx.Response(200, json=self._payload(60, wikidata=True))

        monkeypatch.setattr(discover, "fame", _no_fame)
        monkeypatch.setattr(httpx, "AsyncClient", _transport(handler))
        await discover.around(35.69, 139.70, 5.0)
        assert len(asked) == 1

    @pytest.mark.anyio
    async def test_the_wider_answer_does_not_bring_back_what_was_already_found(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The wider query is the narrow one minus a filter, so everything
        # the first ask returned comes back in the second.
        def handler(request: httpx.Request) -> httpx.Response:
            if "wikidata" in unquote_plus(request.content.decode()):
                return httpx.Response(200, json=self._payload(2, wikidata=True))
            return httpx.Response(200, json=self._payload(30, wikidata=False))

        monkeypatch.setattr(discover, "fame", _no_fame)
        monkeypatch.setattr(httpx, "AsyncClient", _transport(handler))
        found = await discover.around(-41.13, -71.31, 5.0)

        assert len(found) == 30
        assert len({place.osm_id for place in found}) == 30


class TestTheOrderThatComesOut:
    @pytest.mark.anyio
    async def test_the_answer_is_ordered_from_where_you_are_staying(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`around` knows the centre; `rank` only knows it if told.

        Written because sabotaging the centre out of that call changed no
        test at all: the ordering was proved in isolation and never on the
        way through. Named so the alphabet would give the wrong answer.
        """
        payload = {
            "elements": [
                {
                    "type": "node",
                    "id": 1,
                    "lat": 35.40,
                    "lon": 139.40,
                    "tags": {"name": "Aquarium far away", "tourism": "attraction"},
                },
                {
                    "type": "node",
                    "id": 2,
                    "lat": 35.001,
                    "lon": 139.001,
                    "tags": {"name": "Zoo round the corner", "tourism": "attraction"},
                },
            ]
        }

        monkeypatch.setattr(discover, "fame", _no_fame)
        monkeypatch.setattr(
            httpx, "AsyncClient", _transport(lambda _: httpx.Response(200, json=payload))
        )
        found = await discover.around(35.0, 139.0, 5.0)

        assert [place.name for place in found] == [
            "Zoo round the corner",
            "Aquarium far away",
        ]


class TestTheCeiling:
    @pytest.mark.anyio
    async def test_it_gives_back_what_it_has_rather_than_running_on(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Measured at Bariloche before this existed: eighty-five seconds,
        and then nothing. There are up to four asks in here and each may
        retry, so the per-request timeouts multiply."""

        async def slow(*args: object, **kwargs: object) -> dict | None:
            await asyncio.sleep(5)
            return None

        monkeypatch.setattr(discover, "_DEADLINE", 0.05)
        monkeypatch.setattr(discover, "_overpass", slow)
        started = time.monotonic()
        assert await discover.around(35.69, 139.70, 5.0) == []
        assert time.monotonic() - started < 2


class TestOrderingWhereNothingIsRankable:
    def test_the_famous_come_first_and_then_the_near(self) -> None:
        """A city that needed the wider query has no fame scores at all, so
        the tiebreak is the whole order. Alphabetical made Kathmandu's
        eleven hundred places into sixty small stupas beginning with A."""
        centre = (35.0, 139.0)
        far_famous = discover.Suggestion(
            name="Zoo",
            lat=35.4,
            lon=139.4,
            category=PlaceCategory.SIGHT,
            fame=30,
            wikidata="Q1",
            osm_id="n/1",
        )
        near_unknown = discover.Suggestion(
            name="Zebra crossing",
            lat=35.001,
            lon=139.001,
            category=PlaceCategory.SIGHT,
            fame=0,
            wikidata=None,
            osm_id="n/2",
        )
        far_unknown = discover.Suggestion(
            name="Abbey",
            lat=35.4,
            lon=139.4,
            category=PlaceCategory.SIGHT,
            fame=0,
            wikidata=None,
            osm_id="n/3",
        )

        ordered = discover.rank([far_unknown, near_unknown, far_famous], centre)
        assert [place.osm_id for place in ordered] == ["n/1", "n/2", "n/3"]

    def test_without_a_centre_it_falls_back_to_the_alphabet(self) -> None:
        a = discover.Suggestion(
            name="Abbey",
            lat=1.0,
            lon=1.0,
            category=PlaceCategory.SIGHT,
            fame=0,
            wikidata=None,
            osm_id="n/1",
        )
        z = discover.Suggestion(
            name="Zoo",
            lat=0.0,
            lon=0.0,
            category=PlaceCategory.SIGHT,
            fame=0,
            wikidata=None,
            osm_id="n/2",
        )
        assert [p.osm_id for p in discover.rank([z, a])] == ["n/1", "n/2"]
