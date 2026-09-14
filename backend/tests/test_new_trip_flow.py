def test_the_new_trip_form_payload_is_accepted(client) -> None:
    """The exact two requests the form makes, in order.

    A field named `country` instead of `country_code` is a 422 here —
    `WriteModel` forbids extras on purpose — and would have meant a trip
    created with no stop, discovered only in production.
    """
    trip = client.post(
        "/api/trips",
        json={
            "title": "Tokyo",
            "destination_label": "Tokyo",
            "start_date": "2026-04-11",
            "end_date": "2026-04-24",
            "primary_tz": "Europe/Rome",
            "primary_currency": "EUR",
            "status": "planned",
        },
    )
    assert trip.status_code == 201, trip.text
    trip_id = trip.json()["id"]

    stop = client.post(
        f"/api/trips/{trip_id}/stops",
        json={
            "name": "Tokyo",
            "tz": "Asia/Tokyo",
            "country_code": "JP",
            "lat": 35.6895,
            "lon": 139.6917,
            "arrive_date": "2026-04-11",
            "depart_date": "2026-04-24",
        },
    )
    assert stop.status_code == 201, stop.text
    body = stop.json()
    assert body["tz"] == "Asia/Tokyo"
    assert body["lat"] is not None and body["lon"] is not None
    assert body["country_code"] == "JP"
