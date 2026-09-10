"""The packing list.

Every route here is written at an id the client chose, because ticking
things off is what the offline queue exists for. The tests that matter are
therefore the ones about replaying a write.
"""

import uuid

from fastapi.testclient import TestClient


def _trip(client: TestClient) -> str:
    return client.post(
        "/api/trips",
        json={"title": "Japan", "primary_currency": "EUR"},
    ).json()["id"]


def _put(client: TestClient, trip_id: str, item_id: str, **fields):
    body = {"text": "Passaporto", "category": "documents", "is_done": False, "position": 0}
    body.update(fields)
    return client.put(f"/api/trips/{trip_id}/checklist/{item_id}", json=body)


def test_writing_the_same_item_twice_stores_it_once(client: TestClient) -> None:
    """The property the queue depends on: replaying a tick made in a tunnel
    must not add a second line to the list."""
    trip_id = _trip(client)
    item_id = str(uuid.uuid4())

    first = _put(client, trip_id, item_id)
    second = _put(client, trip_id, item_id, is_done=True)

    assert first.status_code == 200
    assert second.status_code == 200
    items = client.get(f"/api/trips/{trip_id}/checklist").json()
    assert len(items) == 1
    assert items[0]["is_done"] is True


def test_a_tick_survives_the_round_trip(client: TestClient) -> None:
    trip_id = _trip(client)
    item_id = str(uuid.uuid4())
    _put(client, trip_id, item_id)
    ticked = _put(client, trip_id, item_id, is_done=True).json()
    assert ticked["is_done"] is True


def test_the_list_comes_back_in_position_order(client: TestClient) -> None:
    trip_id = _trip(client)
    _put(client, trip_id, str(uuid.uuid4()), text="Second", position=1)
    _put(client, trip_id, str(uuid.uuid4()), text="First", position=0)

    texts = [item["text"] for item in client.get(f"/api/trips/{trip_id}/checklist").json()]
    assert texts == ["First", "Second"]


def test_an_invented_category_is_refused(client: TestClient) -> None:
    """Stable English keys, never translated text: "Documenti" must not be
    storable, or the data stops being comparable the day a language is
    added."""
    trip_id = _trip(client)
    response = _put(client, trip_id, str(uuid.uuid4()), category="Documenti")
    assert response.status_code == 422


def test_a_negative_position_is_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    response = _put(client, trip_id, str(uuid.uuid4()), position=-1)
    assert response.status_code == 422


def test_an_item_cannot_be_moved_between_trips(client: TestClient) -> None:
    """A PUT at a chosen id must not let one trip overwrite another's list."""
    mine = _trip(client)
    yours = _trip(client)
    item_id = str(uuid.uuid4())
    _put(client, mine, item_id)

    response = _put(client, yours, item_id, text="Stolen")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "checklist_item_not_found"
    assert client.get(f"/api/trips/{mine}/checklist").json()[0]["text"] == "Passaporto"


def test_deleting_an_item_removes_it(client: TestClient) -> None:
    trip_id = _trip(client)
    item_id = str(uuid.uuid4())
    _put(client, trip_id, item_id)

    assert client.delete(f"/api/trips/{trip_id}/checklist/{item_id}").status_code == 204
    assert client.get(f"/api/trips/{trip_id}/checklist").json() == []


def test_deleting_something_that_is_not_there_says_so(client: TestClient) -> None:
    trip_id = _trip(client)
    response = client.delete(f"/api/trips/{trip_id}/checklist/{uuid.uuid4()}")
    assert response.status_code == 404


def test_writing_to_a_trip_that_does_not_exist_says_so(client: TestClient) -> None:
    response = _put(client, str(uuid.uuid4()), str(uuid.uuid4()))
    assert response.status_code == 404


def test_the_checklist_travels_in_the_bundle(client: TestClient) -> None:
    """Nothing on the packing screen may need its own request: offline, the
    bundle is all there is."""
    trip_id = _trip(client)
    _put(client, trip_id, str(uuid.uuid4()), text="Powerbank", category="electronics")

    bundle = client.get(f"/api/trips/{trip_id}/bundle").json()

    assert [item["text"] for item in bundle["checklist"]] == ["Powerbank"]


def test_deleting_a_trip_takes_its_checklist_with_it(client: TestClient) -> None:
    trip_id = _trip(client)
    item_id = str(uuid.uuid4())
    _put(client, trip_id, item_id)

    client.delete(f"/api/trips/{trip_id}")

    assert client.get(f"/api/trips/{trip_id}/checklist").status_code == 404
