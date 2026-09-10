"""The single-request trip snapshot the phone caches for offline use."""

from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import make_attachment


def _trip_with_content(client: TestClient) -> dict:
    trip = client.post("/api/trips", json={"title": "Japan"}).json()
    stop = client.post(
        f"/api/trips/{trip['id']}/stops", json={"name": "Tokyo", "tz": "Asia/Tokyo"}
    ).json()
    booking = client.post(
        f"/api/trips/{trip['id']}/bookings",
        json={
            "kind": "hotel",
            "title": "Gracery",
            "stop_id": stop["id"],
            "start_at": "2026-04-12T15:00:00+09:00",
            "start_tz": "Asia/Tokyo",
        },
    ).json()
    place = client.post(
        f"/api/trips/{trip['id']}/places", json={"name": "Senso-ji", "category": "temple"}
    ).json()
    return {"trip": trip, "stop": stop, "booking": booking, "place": place}


def test_the_bundle_carries_the_whole_trip(client: TestClient) -> None:
    made = _trip_with_content(client)
    bundle = client.get(f"/api/trips/{made['trip']['id']}/bundle").json()

    assert bundle["trip"]["id"] == made["trip"]["id"]
    assert [item["id"] for item in bundle["stops"]] == [made["stop"]["id"]]
    assert [item["id"] for item in bundle["bookings"]] == [made["booking"]["id"]]
    assert [item["id"] for item in bundle["places"]] == [made["place"]["id"]]
    assert bundle["generated_at"]


def test_it_includes_documents_owned_by_a_booking(client: TestClient, db_session: Session) -> None:
    """The subtle one.

    An attachment hangs off exactly one owner. Filtering the bundle on
    `trip_id` alone would silently omit every hotel voucher — which is
    precisely the file you need at the reception desk.
    """
    made = _trip_with_content(client)
    make_attachment(db_session, trip_id=UUID(made["trip"]["id"]))
    make_attachment(db_session, booking_id=UUID(made["booking"]["id"]))
    make_attachment(db_session, stop_id=UUID(made["stop"]["id"]))

    bundle = client.get(f"/api/trips/{made['trip']['id']}/bundle").json()
    owners = {
        ("trip" if item["trip_id"] else "stop" if item["stop_id"] else "booking")
        for item in bundle["attachments"]
    }
    assert owners == {"trip", "stop", "booking"}


def test_the_bundle_never_carries_file_bytes(client: TestClient, db_session: Session) -> None:
    made = _trip_with_content(client)
    make_attachment(db_session, booking_id=UUID(made["booking"]["id"]), data=b"SECRETBYTES" * 100)

    raw = client.get(f"/api/trips/{made['trip']['id']}/bundle").text
    assert "SECRETBYTES" not in raw
    assert (
        "data" not in client.get(f"/api/trips/{made['trip']['id']}/bundle").json()["attachments"][0]
    )


def test_an_unchanged_bundle_answers_304(client: TestClient) -> None:
    made = _trip_with_content(client)
    url = f"/api/trips/{made['trip']['id']}/bundle"

    first = client.get(url)
    assert first.status_code == 200
    etag = first.headers["etag"]

    again = client.get(url, headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""


def test_a_weak_etag_still_matches(client: TestClient) -> None:
    """Proxies may weaken an ETag by prefixing `W/`. Comparing the raw string
    would then miss the match and re-send the whole trip for nothing."""
    made = _trip_with_content(client)
    url = f"/api/trips/{made['trip']['id']}/bundle"
    etag = client.get(url).headers["etag"]

    assert client.get(url, headers={"If-None-Match": f"W/{etag}"}).status_code == 304


def test_the_etag_changes_when_anything_changes(client: TestClient) -> None:
    made = _trip_with_content(client)
    url = f"/api/trips/{made['trip']['id']}/bundle"
    before = client.get(url).headers["etag"]

    client.patch(
        f"/api/trips/{made['trip']['id']}/bookings/{made['booking']['id']}",
        json={"confirmation_code": "ABC123"},
    )
    after = client.get(url).headers["etag"]
    assert after != before

    # A deletion must move it too, not just an edit.
    client.delete(f"/api/trips/{made['trip']['id']}/places/{made['place']['id']}")
    assert client.get(url).headers["etag"] != after


def test_the_etag_notices_a_new_document(client: TestClient, db_session: Session) -> None:
    """Adding a voucher changes nothing on the trip row, so an ETag built only
    from `trip.updated_at` would keep serving 304 and the phone would never
    learn the file exists."""
    made = _trip_with_content(client)
    url = f"/api/trips/{made['trip']['id']}/bundle"
    before = client.get(url).headers["etag"]

    make_attachment(db_session, booking_id=UUID(made["booking"]["id"]))
    assert client.get(url).headers["etag"] != before
