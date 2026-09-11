"""Memory points: where a photo was taken, never the photo.

The image never reaches this server, so there is nothing here about
uploads. What matters is that re-importing the same photographs does not
double them, and that a point always knows the zone it should be read in.
"""

import uuid

from fastapi.testclient import TestClient


def _trip(client: TestClient) -> str:
    return client.post("/api/trips", json={"title": "Japan"}).json()["id"]


def _put(client: TestClient, trip_id: str, memory_id: str, **fields):
    body = {
        "lat": 35.7148,
        "lon": 139.7967,
        "taken_at": "2026-04-13T14:20:00+09:00",
        "taken_tz": "Asia/Tokyo",
        "time_source": "exif",
        "filename": "IMG_20260413_142000.jpg",
        **fields,
    }
    return client.put(f"/api/trips/{trip_id}/memories/{memory_id}", json=body)


def test_importing_the_same_photo_twice_stores_one_point(client: TestClient) -> None:
    """The id is derived from the photograph, so re-importing a folder —
    or importing it again on another device — is a no-op."""
    trip_id = _trip(client)
    memory_id = str(uuid.uuid4())

    _put(client, trip_id, memory_id)
    _put(client, trip_id, memory_id)

    assert len(client.get(f"/api/trips/{trip_id}/memories").json()) == 1


def test_a_point_keeps_the_instant_and_the_zone_apart(client: TestClient) -> None:
    """14:20 in Kyoto must read 14:20 from an armchair in Rome."""
    trip_id = _trip(client)
    _put(client, trip_id, str(uuid.uuid4()))

    # Read back through the database, which is where the conversion to
    # UTC actually happens.
    stored = client.get(f"/api/trips/{trip_id}/memories").json()[0]
    assert stored["taken_at"] == "2026-04-13T05:20:00Z"
    assert stored["taken_tz"] == "Asia/Tokyo"


def test_it_records_whether_the_time_was_known_or_inferred(client: TestClient) -> None:
    """A guess presented as a fact is the thing to avoid: most photos have
    no offset recorded and their instant is inferred from where they were
    taken."""
    trip_id = _trip(client)
    assumed = _put(client, trip_id, str(uuid.uuid4()), time_source="assumed").json()
    assert assumed["time_source"] == "assumed"


def test_an_invented_time_source_is_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    assert _put(client, trip_id, str(uuid.uuid4()), time_source="guessed").status_code == 422


def test_a_naive_timestamp_is_refused(client: TestClient) -> None:
    """An instant with no offset cannot be placed on a timeline, and
    guessing one is how a photo ends up on the wrong day."""
    trip_id = _trip(client)
    response = _put(client, trip_id, str(uuid.uuid4()), taken_at="2026-04-13T14:20:00")
    assert response.status_code == 422


def test_coordinates_outside_the_world_are_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    assert _put(client, trip_id, str(uuid.uuid4()), lat=91).status_code == 422
    assert _put(client, trip_id, str(uuid.uuid4()), lon=-181).status_code == 422


def test_points_come_back_in_the_order_they_were_taken(client: TestClient) -> None:
    trip_id = _trip(client)
    _put(client, trip_id, str(uuid.uuid4()), taken_at="2026-04-14T14:20:00+09:00")
    _put(client, trip_id, str(uuid.uuid4()), taken_at="2026-04-13T14:20:00+09:00")

    days = [point["taken_at"] for point in client.get(f"/api/trips/{trip_id}/memories").json()]
    assert days == sorted(days)


def test_a_point_cannot_be_moved_between_trips(client: TestClient) -> None:
    mine = _trip(client)
    yours = _trip(client)
    memory_id = str(uuid.uuid4())
    _put(client, mine, memory_id)

    response = _put(client, yours, memory_id, filename="stolen.jpg")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "memory_not_found"


def test_deleting_a_point_removes_it(client: TestClient) -> None:
    trip_id = _trip(client)
    memory_id = str(uuid.uuid4())
    _put(client, trip_id, memory_id)

    assert client.delete(f"/api/trips/{trip_id}/memories/{memory_id}").status_code == 204
    assert client.get(f"/api/trips/{trip_id}/memories").json() == []


def test_the_points_travel_in_the_bundle(client: TestClient) -> None:
    trip_id = _trip(client)
    _put(client, trip_id, str(uuid.uuid4()))

    bundle = client.get(f"/api/trips/{trip_id}/bundle").json()

    assert len(bundle["memories"]) == 1


def test_importing_photos_moves_the_bundle_etag(client: TestClient) -> None:
    trip_id = _trip(client)
    url = f"/api/trips/{trip_id}/bundle"
    before = client.get(url).headers["etag"]

    _put(client, trip_id, str(uuid.uuid4()))

    assert client.get(url).headers["etag"] != before


def test_no_route_here_accepts_a_file(client: TestClient) -> None:
    """The promise the whole design rests on: the photograph never leaves
    the device. A route that took an upload would quietly break it, and
    half a gigabyte of Neon would not survive the attempt anyway.
    """
    paths = client.app.openapi()["paths"]
    memory_routes = {path: spec for path, spec in paths.items() if "/memories" in path}
    assert memory_routes

    for spec in memory_routes.values():
        for operation in spec.values():
            content = (operation.get("requestBody") or {}).get("content", {})
            assert "multipart/form-data" not in content
            assert set(content) <= {"application/json"}


def test_deleting_a_trip_takes_its_memories_with_it(client: TestClient) -> None:
    trip_id = _trip(client)
    _put(client, trip_id, str(uuid.uuid4()))

    client.delete(f"/api/trips/{trip_id}")

    assert client.get(f"/api/trips/{trip_id}/memories").status_code == 404
