"""Recording what a trip actually costs."""

import uuid

from fastapi.testclient import TestClient


def _trip(client: TestClient, **extra) -> str:
    return client.post(
        "/api/trips",
        json={"title": "Japan", "primary_currency": "EUR", **extra},
    ).json()["id"]


def _put(client: TestClient, trip_id: str, expense_id: str, **fields):
    body = {
        "description": "Ramen",
        "amount": "980.00",
        "currency": "JPY",
        "spent_at": "2026-04-13",
        "category": "food",
        "payment_method": "cash",
        **fields,
    }
    return client.put(f"/api/trips/{trip_id}/expenses/{expense_id}", json=body)


def test_an_expense_keeps_the_currency_it_was_paid_in(client: TestClient) -> None:
    """Converting on the way in and storing only euros would throw away the
    one number you can still check against a statement."""
    trip_id = _trip(client)
    expense = _put(client, trip_id, str(uuid.uuid4())).json()

    assert expense["amount"] == "980.00"
    assert expense["currency"] == "JPY"
    assert expense["rate"] is None


def test_writing_the_same_expense_twice_stores_it_once(client: TestClient) -> None:
    """The property the offline queue depends on: a replayed write after a
    tunnel must not leave two coffees."""
    trip_id = _trip(client)
    expense_id = str(uuid.uuid4())

    first = _put(client, trip_id, expense_id)
    second = _put(client, trip_id, expense_id)

    assert first.status_code == 200
    assert second.status_code == 200
    assert len(client.get(f"/api/trips/{trip_id}/expenses").json()) == 1


def test_a_repeat_write_can_correct_the_first(client: TestClient) -> None:
    trip_id = _trip(client)
    expense_id = str(uuid.uuid4())
    _put(client, trip_id, expense_id, amount="980.00")
    corrected = _put(client, trip_id, expense_id, amount="1080.00").json()
    assert corrected["amount"] == "1080.00"


def test_a_rate_must_say_where_it_came_from(client: TestClient) -> None:
    """A rate with no date and no source cannot be checked or replaced when
    the statement arrives, which is the whole point of storing one."""
    trip_id = _trip(client)
    response = _put(client, trip_id, str(uuid.uuid4()), rate="0.0061")
    assert response.status_code == 422

    ok = _put(
        client,
        trip_id,
        str(uuid.uuid4()),
        rate="0.0061",
        rate_date="2026-04-13",
        rate_source="ecb",
    )
    assert ok.status_code == 200
    assert ok.json()["rate_source"] == "ecb"


def test_a_negative_amount_is_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    assert _put(client, trip_id, str(uuid.uuid4()), amount="-5.00").status_code == 422


def test_a_translated_category_is_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    assert _put(client, trip_id, str(uuid.uuid4()), category="Cibo").status_code == 422


def test_expenses_reach_the_offline_bundle(client: TestClient) -> None:
    trip_id = _trip(client)
    _put(client, trip_id, str(uuid.uuid4()))
    assert len(client.get(f"/api/trips/{trip_id}/bundle").json()["expenses"]) == 1


def test_a_new_expense_changes_the_bundle_etag(client: TestClient) -> None:
    trip_id = _trip(client)
    url = f"/api/trips/{trip_id}/bundle"
    before = client.get(url).headers["etag"]
    _put(client, trip_id, str(uuid.uuid4()))
    assert client.get(url).headers["etag"] != before


def test_an_expense_cannot_be_moved_between_trips(client: TestClient) -> None:
    first = _trip(client)
    second = _trip(client)
    expense_id = str(uuid.uuid4())
    _put(client, first, expense_id)

    response = _put(client, second, expense_id)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "expense_not_found"


def test_deleting_an_expense(client: TestClient) -> None:
    trip_id = _trip(client)
    expense_id = str(uuid.uuid4())
    _put(client, trip_id, expense_id)

    assert client.delete(f"/api/trips/{trip_id}/expenses/{expense_id}").status_code == 204
    assert client.get(f"/api/trips/{trip_id}/expenses").json() == []


def test_deleting_a_trip_takes_its_expenses(client: TestClient) -> None:
    trip_id = _trip(client)
    _put(client, trip_id, str(uuid.uuid4()))
    assert client.delete(f"/api/trips/{trip_id}").status_code == 204
