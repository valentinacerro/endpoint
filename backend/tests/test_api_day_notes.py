"""Notes attached to a day rather than to anything on it."""

from fastapi.testclient import TestClient


def _trip(client: TestClient) -> str:
    return client.post(
        "/api/trips",
        json={"title": "Japan", "start_date": "2026-04-11", "end_date": "2026-04-14"},
    ).json()["id"]


def test_writing_a_note_twice_replaces_it(client: TestClient) -> None:
    """PUT addressed by date is an upsert, so a repeated write is harmless —
    which is what the offline queue will rely on."""
    trip_id = _trip(client)
    url = f"/api/trips/{trip_id}/days/2026-04-13/note"

    first = client.put(url, json={"note": "Giornata libera"})
    assert first.status_code == 200
    assert first.json()["day"] == "2026-04-13"

    second = client.put(url, json={"note": "Giornata libera a Kyoto"})
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["note"] == "Giornata libera a Kyoto"

    bundle = client.get(f"/api/trips/{trip_id}/bundle").json()
    assert len(bundle["day_notes"]) == 1


def test_notes_reach_the_offline_bundle(client: TestClient) -> None:
    trip_id = _trip(client)
    client.put(f"/api/trips/{trip_id}/days/2026-04-12/note", json={"note": "Comprare il JR Pass"})
    client.put(f"/api/trips/{trip_id}/days/2026-04-11/note", json={"note": "Volo la sera"})

    notes = client.get(f"/api/trips/{trip_id}/bundle").json()["day_notes"]
    # Ordered by day, so the timeline can walk them alongside the itinerary.
    assert [item["day"] for item in notes] == ["2026-04-11", "2026-04-12"]


def test_a_new_note_changes_the_bundle_etag(client: TestClient) -> None:
    """Otherwise the phone would keep a 304 and never learn the note exists."""
    trip_id = _trip(client)
    url = f"/api/trips/{trip_id}/bundle"
    before = client.get(url).headers["etag"]

    client.put(f"/api/trips/{trip_id}/days/2026-04-13/note", json={"note": "x"})
    after = client.get(url).headers["etag"]
    assert after != before

    client.delete(f"/api/trips/{trip_id}/days/2026-04-13/note")
    assert client.get(url).headers["etag"] != after


def test_clearing_a_note(client: TestClient) -> None:
    trip_id = _trip(client)
    url = f"/api/trips/{trip_id}/days/2026-04-13/note"
    client.put(url, json={"note": "x"})

    assert client.delete(url).status_code == 204
    assert client.get(f"/api/trips/{trip_id}/bundle").json()["day_notes"] == []

    missing = client.delete(url)
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "day_note_not_found"


def test_a_day_that_says_nothing_at_all_is_refused(client: TestClient) -> None:
    """Clearing is a DELETE. A row with neither a note nor a theme is a
    blank that renders as a mysterious gap in the day."""
    trip_id = _trip(client)
    response = client.put(f"/api/trips/{trip_id}/days/2026-04-13/note", json={"note": ""})
    assert response.status_code == 422


def test_a_theme_alone_is_enough_to_be_worth_a_row(client: TestClient) -> None:
    # "Magari mi va di farmi la strada dei negozi" is a thing to say about
    # a day without writing a sentence about it.
    trip_id = _trip(client)
    response = client.put(
        f"/api/trips/{trip_id}/days/2026-04-13/note", json={"note": "", "theme": "shopping"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["theme"] == "shopping"
    assert response.json()["note"] == ""


def test_setting_a_theme_carries_the_note_with_it(client: TestClient) -> None:
    """A whole-object write: the client holds both and sends both.

    Sending only the theme would wipe a note written ten minutes earlier,
    which is the kind of loss nobody connects to the control they pressed.
    """
    trip_id = _trip(client)
    url = f"/api/trips/{trip_id}/days/2026-04-13/note"
    client.put(url, json={"note": "chiuso il lunedì"})

    kept = client.put(url, json={"note": "chiuso il lunedì", "theme": "museums"}).json()
    assert kept["note"] == "chiuso il lunedì"
    assert kept["theme"] == "museums"

    # And a later write with no theme takes it off again, because the body
    # is the whole day and not a patch.
    cleared = client.put(url, json={"note": "chiuso il lunedì"})
    assert cleared.json()["theme"] is None


def test_an_invented_theme_is_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    response = client.put(
        f"/api/trips/{trip_id}/days/2026-04-13/note", json={"note": "", "theme": "sci"}
    )
    assert response.status_code == 422


def test_a_malformed_date_is_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    response = client.put(f"/api/trips/{trip_id}/days/13-04-2026/note", json={"note": "x"})
    assert response.status_code == 422


def test_notes_belong_to_their_trip(client: TestClient) -> None:
    first = _trip(client)
    second = _trip(client)
    client.put(f"/api/trips/{first}/days/2026-04-13/note", json={"note": "solo qui"})

    assert client.get(f"/api/trips/{second}/bundle").json()["day_notes"] == []
