"""Creating things at an id the client picked, so a create can be queued.

Adding a place, a city or a booking used to be a POST, and a POST cannot
go in the offline queue: the server names the row, so replaying a lost
request produces a second one. These routes move the naming to the client,
which is what lets "add Fushimi Inari" happen on a train with no signal.

Every test here is about the replay, not the first write. The first write
was already covered; what was not covered is what happens when the same
request arrives twice, or arrives pointed at the wrong trip.
"""

import uuid

from fastapi.testclient import TestClient


def _trip(client: TestClient, **overrides) -> str:
    response = client.post("/api/trips", json={"title": "Japan", **overrides})
    assert response.status_code == 201, response.text
    return response.json()["id"]


# --- Places ---


def test_a_replayed_place_creates_one_place(client: TestClient) -> None:
    trip = _trip(client)
    place_id = str(uuid.uuid4())
    body = {"name": "Fushimi Inari", "category": "sight", "visit_minutes": 90}

    first = client.put(f"/api/trips/{trip}/places/{place_id}", json=body)
    assert first.status_code == 200, first.text
    assert first.json()["id"] == place_id

    # The reply to the first was lost in a tunnel, so the queue sends it again.
    second = client.put(f"/api/trips/{trip}/places/{place_id}", json=body)
    assert second.status_code == 200

    listed = client.get(f"/api/trips/{trip}/places").json()
    assert [item["name"] for item in listed] == ["Fushimi Inari"]


def test_a_second_write_replaces_rather_than_merges(client: TestClient) -> None:
    """The body is the whole place: a field left out goes back to its default.

    A queued create edited before it drains sends one write carrying the
    last version. Merging would leave fields from a version the user had
    already changed their mind about.
    """
    trip = _trip(client)
    place_id = str(uuid.uuid4())
    client.put(
        f"/api/trips/{trip}/places/{place_id}",
        json={"name": "Fushimi Inari", "notes": "go at dawn", "visit_minutes": 90},
    )

    replaced = client.put(
        f"/api/trips/{trip}/places/{place_id}", json={"name": "Fushimi Inari-taisha"}
    )
    assert replaced.status_code == 200
    assert replaced.json()["name"] == "Fushimi Inari-taisha"
    assert replaced.json()["notes"] is None
    assert replaced.json()["visit_minutes"] == 60


def test_a_place_id_from_another_trip_is_refused(client: TestClient) -> None:
    """A primary key is global; the URL is not. Without this check a replay
    aimed at the wrong trip would quietly move a place between trips."""
    first = _trip(client)
    second = _trip(client, title="Portugal")
    place_id = client.post(f"/api/trips/{first}/places", json={"name": "Senso-ji"}).json()["id"]

    response = client.put(f"/api/trips/{second}/places/{place_id}", json={"name": "Belem"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "place_not_found"

    # And the place it aimed at is untouched, still on the trip it belongs to.
    still = client.get(f"/api/trips/{first}/places/{place_id}").json()
    assert still["name"] == "Senso-ji"


def test_putting_a_place_into_a_stop_from_another_trip_is_refused(client: TestClient) -> None:
    first = _trip(client)
    other = _trip(client, title="Portugal")
    stop = client.post(f"/api/trips/{other}/stops", json={"name": "Lisbon", "tz": "Europe/Lisbon"})
    response = client.put(
        f"/api/trips/{first}/places/{uuid.uuid4()}",
        json={"name": "Senso-ji", "stop_id": stop.json()["id"]},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "stop_not_found"


def test_a_place_put_onto_a_missing_trip_is_refused(client: TestClient) -> None:
    response = client.put(
        f"/api/trips/{uuid.uuid4()}/places/{uuid.uuid4()}", json={"name": "Senso-ji"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "trip_not_found"


def test_a_put_place_still_derives_its_exposure(client: TestClient) -> None:
    """The rules the POST applies are the schema's, so this route has them too."""
    trip = _trip(client)
    response = client.put(
        f"/api/trips/{trip}/places/{uuid.uuid4()}",
        json={"name": "Shinjuku Gyoen", "category": "park"},
    )
    assert response.json()["weather_exposure"] == "outdoor"


def test_a_put_place_scheduled_without_a_zone_is_refused(client: TestClient) -> None:
    trip = _trip(client)
    response = client.put(
        f"/api/trips/{trip}/places/{uuid.uuid4()}",
        json={"name": "Senso-ji", "planned_start_at": "2026-04-13T09:00:00Z"},
    )
    assert response.status_code == 422


# --- Stops ---


def test_a_replayed_stop_creates_one_stop(client: TestClient) -> None:
    trip = _trip(client)
    stop_id = str(uuid.uuid4())
    body = {"name": "Kyoto", "tz": "Asia/Tokyo"}

    assert client.put(f"/api/trips/{trip}/stops/{stop_id}", json=body).status_code == 200
    assert client.put(f"/api/trips/{trip}/stops/{stop_id}", json=body).status_code == 200

    listed = client.get(f"/api/trips/{trip}/stops").json()
    assert [item["name"] for item in listed] == ["Kyoto"]


def test_a_replayed_stop_keeps_its_place_in_the_order(client: TestClient) -> None:
    """The body carries no position, and a replay is not a request to move.

    Appending again would put Tokyo after Osaka, which is the kind of thing
    that reorders an itinerary while the phone is in a pocket.
    """
    trip = _trip(client)
    tokyo = str(uuid.uuid4())
    client.put(f"/api/trips/{trip}/stops/{tokyo}", json={"name": "Tokyo", "tz": "Asia/Tokyo"})
    client.post(f"/api/trips/{trip}/stops", json={"name": "Osaka", "tz": "Asia/Tokyo"})

    client.put(f"/api/trips/{trip}/stops/{tokyo}", json={"name": "Tokyo", "tz": "Asia/Tokyo"})

    listed = client.get(f"/api/trips/{trip}/stops").json()
    assert [item["name"] for item in listed] == ["Tokyo", "Osaka"]
    assert [item["position"] for item in listed] == [0, 1]


def test_a_stop_id_from_another_trip_is_refused(client: TestClient) -> None:
    first = _trip(client)
    second = _trip(client, title="Portugal")
    stop_id = client.post(
        f"/api/trips/{first}/stops", json={"name": "Tokyo", "tz": "Asia/Tokyo"}
    ).json()["id"]

    response = client.put(
        f"/api/trips/{second}/stops/{stop_id}", json={"name": "Lisbon", "tz": "Europe/Lisbon"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "stop_not_found"


def test_a_put_stop_with_dates_the_wrong_way_round_is_refused(client: TestClient) -> None:
    trip = _trip(client)
    response = client.put(
        f"/api/trips/{trip}/stops/{uuid.uuid4()}",
        json={
            "name": "Tokyo",
            "tz": "Asia/Tokyo",
            "arrive_date": "2026-04-18",
            "depart_date": "2026-04-11",
        },
    )
    assert response.status_code == 422


# --- Bookings ---


def test_a_replayed_booking_creates_one_booking(client: TestClient) -> None:
    trip = _trip(client)
    booking_id = str(uuid.uuid4())
    body = {
        "kind": "flight",
        "title": "FCO to HND",
        "start_at": "2026-04-11T13:40:00Z",
        "start_tz": "Europe/Rome",
    }

    assert client.put(f"/api/trips/{trip}/bookings/{booking_id}", json=body).status_code == 200
    assert client.put(f"/api/trips/{trip}/bookings/{booking_id}", json=body).status_code == 200

    listed = client.get(f"/api/trips/{trip}/bookings").json()
    assert [item["title"] for item in listed] == ["FCO to HND"]


def test_a_booking_id_from_another_trip_is_refused(client: TestClient) -> None:
    first = _trip(client)
    second = _trip(client, title="Portugal")
    booking_id = client.post(
        f"/api/trips/{first}/bookings", json={"kind": "hotel", "title": "Gracery"}
    ).json()["id"]

    response = client.put(
        f"/api/trips/{second}/bookings/{booking_id}", json={"kind": "hotel", "title": "Pousada"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "booking_not_found"


def test_a_put_booking_that_ends_before_it_starts_is_refused(client: TestClient) -> None:
    """Checked against the merged result, the way the PATCH does it."""
    trip = _trip(client)
    booking_id = str(uuid.uuid4())
    client.put(
        f"/api/trips/{trip}/bookings/{booking_id}",
        json={
            "kind": "hotel",
            "title": "Gracery",
            "start_at": "2026-04-11T05:00:00Z",
            "start_tz": "Asia/Tokyo",
        },
    )
    response = client.put(
        f"/api/trips/{trip}/bookings/{booking_id}",
        json={
            "kind": "hotel",
            "title": "Gracery",
            "start_at": "2026-04-14T05:00:00Z",
            "start_tz": "Asia/Tokyo",
            "end_at": "2026-04-11T01:00:00Z",
            "end_tz": "Asia/Tokyo",
        },
    )
    assert response.status_code == 422


def test_putting_a_booking_into_a_stop_from_another_trip_is_refused(client: TestClient) -> None:
    first = _trip(client)
    other = _trip(client, title="Portugal")
    stop = client.post(f"/api/trips/{other}/stops", json={"name": "Lisbon", "tz": "Europe/Lisbon"})
    response = client.put(
        f"/api/trips/{first}/bookings/{uuid.uuid4()}",
        json={"kind": "hotel", "title": "Gracery", "stop_id": stop.json()["id"]},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "stop_not_found"
