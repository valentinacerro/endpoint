"""The API surface: what it accepts, what it refuses, and with which code."""

from fastapi.testclient import TestClient


def _create_trip(client: TestClient, **overrides) -> dict:
    response = client.post("/api/trips", json={"title": "Japan", **overrides})
    assert response.status_code == 201, response.text
    return response.json()


def test_trip_round_trip(client: TestClient) -> None:
    trip = _create_trip(client, start_date="2026-04-11", end_date="2026-04-25")
    assert trip["primary_tz"] == "Europe/Rome"
    assert trip["status"] == "planned"

    listed = client.get("/api/trips").json()
    assert [item["id"] for item in listed] == [trip["id"]]

    patched = client.patch(f"/api/trips/{trip['id']}", json={"title": "Japan 2026"})
    assert patched.status_code == 200
    assert patched.json()["title"] == "Japan 2026"
    # Untouched fields must survive a partial update.
    assert patched.json()["start_date"] == "2026-04-11"

    assert client.delete(f"/api/trips/{trip['id']}").status_code == 204
    assert client.get(f"/api/trips/{trip['id']}").status_code == 404


def test_a_partial_update_can_clear_a_field(client: TestClient) -> None:
    """Sending null must mean "clear it", while omitting means "leave it"."""
    trip = _create_trip(client, notes="remember the JR Pass")

    unchanged = client.patch(f"/api/trips/{trip['id']}", json={"title": "Japan"}).json()
    assert unchanged["notes"] == "remember the JR Pass"

    cleared = client.patch(f"/api/trips/{trip['id']}", json={"notes": None}).json()
    assert cleared["notes"] is None


def test_a_trip_can_carry_a_budget(client: TestClient) -> None:
    trip = _create_trip(client, budget_amount="2500.00", primary_currency="eur")
    # The budget is expressed in the currency you think in, not the one you
    # spend on the ground.
    assert trip["budget_amount"] == "2500.00"
    assert trip["primary_currency"] == "EUR"

    cleared = client.patch(f"/api/trips/{trip['id']}", json={"budget_amount": None}).json()
    assert cleared["budget_amount"] is None


def test_a_negative_budget_is_refused(client: TestClient) -> None:
    response = client.post("/api/trips", json={"title": "x", "budget_amount": "-10.00"})
    assert response.status_code == 422


def test_an_unknown_timezone_is_refused(client: TestClient) -> None:
    response = client.post("/api/trips", json={"title": "x", "primary_tz": "Asia/Tokio"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_a_misspelled_field_is_refused_rather_than_ignored(client: TestClient) -> None:
    """Silently dropping an unknown field is how a bug hides for a week."""
    response = client.post("/api/trips", json={"title": "x", "titel": "typo"})
    assert response.status_code == 422


def test_translated_labels_are_refused_at_the_boundary(client: TestClient) -> None:
    trip = _create_trip(client)
    for rejected in ("Hotel", "albergo", "Volo"):
        response = client.post(
            f"/api/trips/{trip['id']}/bookings",
            json={"kind": rejected, "title": "x"},
        )
        assert response.status_code == 422, rejected


def test_a_naive_datetime_is_a_422_not_a_500(client: TestClient) -> None:
    """The column type would also reject it, but as a server error. Catching
    it in the schema turns a crash into a message naming the field."""
    trip = _create_trip(client)
    response = client.post(
        f"/api/trips/{trip['id']}/bookings",
        json={
            "kind": "flight",
            "title": "NH 204",
            "start_at": "2026-04-12T15:00:00",  # no offset
            "start_tz": "Asia/Tokyo",
        },
    )
    assert response.status_code == 422


def test_a_time_without_its_zone_is_refused(client: TestClient) -> None:
    trip = _create_trip(client)
    response = client.post(
        f"/api/trips/{trip['id']}/bookings",
        json={"kind": "flight", "title": "x", "start_at": "2026-04-12T15:00:00+09:00"},
    )
    assert response.status_code == 422


def test_an_update_is_validated_against_the_merged_result(client: TestClient) -> None:
    """Sending only `end_at` is fine when `end_tz` is already stored, and must
    still be refused when the resulting order is backwards."""
    trip = _create_trip(client)
    booking = client.post(
        f"/api/trips/{trip['id']}/bookings",
        json={
            "kind": "hotel",
            "title": "Gracery",
            "start_at": "2026-04-12T15:00:00+09:00",
            "start_tz": "Asia/Tokyo",
            "end_tz": "Asia/Tokyo",
        },
    ).json()

    accepted = client.patch(
        f"/api/trips/{trip['id']}/bookings/{booking['id']}",
        json={"end_at": "2026-04-15T10:00:00+09:00"},
    )
    assert accepted.status_code == 200

    refused = client.patch(
        f"/api/trips/{trip['id']}/bookings/{booking['id']}",
        json={"end_at": "2026-04-01T10:00:00+09:00"},
    )
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "invalid_time_fields"


def test_a_booking_cannot_be_reached_through_another_trip(client: TestClient) -> None:
    first = _create_trip(client, title="Japan")
    second = _create_trip(client, title="Portugal")
    booking = client.post(
        f"/api/trips/{first['id']}/bookings", json={"kind": "hotel", "title": "Gracery"}
    ).json()

    response = client.get(f"/api/trips/{second['id']}/bookings/{booking['id']}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "booking_not_found"


def test_stops_are_appended_then_reordered(client: TestClient) -> None:
    trip = _create_trip(client)
    names = ["Tokyo", "Kyoto", "Osaka"]
    created = [
        client.post(
            f"/api/trips/{trip['id']}/stops", json={"name": name, "tz": "Asia/Tokyo"}
        ).json()
        for name in names
    ]
    assert [item["position"] for item in created] == [0, 1, 2]

    reversed_ids = [item["id"] for item in reversed(created)]
    reordered = client.post(
        f"/api/trips/{trip['id']}/stops/reorder", json={"stop_ids": reversed_ids}
    )
    assert reordered.status_code == 200
    assert [item["name"] for item in reordered.json()] == ["Osaka", "Kyoto", "Tokyo"]
    assert [item["position"] for item in reordered.json()] == [0, 1, 2]


def test_an_incomplete_reorder_is_refused(client: TestClient) -> None:
    """Accepting a partial list is how positions end up with holes."""
    trip = _create_trip(client)
    first = client.post(
        f"/api/trips/{trip['id']}/stops", json={"name": "Tokyo", "tz": "Asia/Tokyo"}
    ).json()
    client.post(f"/api/trips/{trip['id']}/stops", json={"name": "Kyoto", "tz": "Asia/Tokyo"})

    response = client.post(
        f"/api/trips/{trip['id']}/stops/reorder", json={"stop_ids": [first["id"]]}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "stop_set_mismatch"


def test_deleting_a_stop_closes_the_gap_in_positions(client: TestClient) -> None:
    trip = _create_trip(client)
    stops = [
        client.post(
            f"/api/trips/{trip['id']}/stops", json={"name": name, "tz": "Asia/Tokyo"}
        ).json()
        for name in ("Tokyo", "Kyoto", "Osaka")
    ]

    assert client.delete(f"/api/trips/{trip['id']}/stops/{stops[1]['id']}").status_code == 204

    remaining = client.get(f"/api/trips/{trip['id']}/stops").json()
    assert [item["name"] for item in remaining] == ["Tokyo", "Osaka"]
    # Contiguous, otherwise the next reorder would be rejected.
    assert [item["position"] for item in remaining] == [0, 1]


def test_place_exposure_is_derived_from_its_category(client: TestClient) -> None:
    trip = _create_trip(client)

    museum = client.post(
        f"/api/trips/{trip['id']}/places", json={"name": "Mori Art", "category": "museum"}
    ).json()
    assert museum["weather_exposure"] == "indoor"

    garden = client.post(
        f"/api/trips/{trip['id']}/places", json={"name": "Rikugien", "category": "garden"}
    ).json()
    assert garden["weather_exposure"] == "outdoor"

    # An explicit value always wins: a covered arcade is shopping but sheltered.
    explicit = client.post(
        f"/api/trips/{trip['id']}/places",
        json={"name": "Rooftop museum", "category": "museum", "weather_exposure": "outdoor"},
    ).json()
    assert explicit["weather_exposure"] == "outdoor"


def test_malformed_opening_hours_are_refused(client: TestClient) -> None:
    trip = _create_trip(client)
    for broken in (
        {"funday": [["09:00", "17:00"]]},
        {"mon": [["9:00", "17:00"]]},
        {"mon": [["17:00", "09:00"]]},
        {"mon": [["09:00"]]},
    ):
        response = client.post(
            f"/api/trips/{trip['id']}/places",
            json={"name": "x", "opening_hours": broken},
        )
        assert response.status_code == 422, broken
