"""The travel diary.

Written at the end of a day, in a hotel room, on whatever the wifi is
doing — so the write has to be addressed by date and safe to replay. Most
of what is worth testing here is that, plus the fact that a diary entry
and a day note are genuinely separate things.
"""

import uuid

from fastapi.testclient import TestClient


def _trip(client: TestClient) -> str:
    return client.post("/api/trips", json={"title": "Japan"}).json()["id"]


def _write(client: TestClient, trip_id: str, day: str, text: str = "Ramen, then rain."):
    return client.put(f"/api/trips/{trip_id}/diary/{day}", json={"text": text})


def test_writing_the_same_day_twice_stores_one_entry(client: TestClient) -> None:
    """The property the offline queue depends on."""
    trip_id = _trip(client)

    first = _write(client, trip_id, "2026-04-13")
    second = _write(client, trip_id, "2026-04-13", "Ramen, then rain. Then a bath.")

    assert first.status_code == 200
    assert second.status_code == 200
    entries = client.get(f"/api/trips/{trip_id}/diary").json()
    assert len(entries) == 1
    assert entries[0]["text"].endswith("Then a bath.")


def test_entries_come_back_in_date_order(client: TestClient) -> None:
    trip_id = _trip(client)
    _write(client, trip_id, "2026-04-15", "third")
    _write(client, trip_id, "2026-04-13", "first")
    _write(client, trip_id, "2026-04-14", "second")

    days = [entry["day"] for entry in client.get(f"/api/trips/{trip_id}/diary").json()]
    assert days == ["2026-04-13", "2026-04-14", "2026-04-15"]


def test_a_diary_entry_is_not_a_day_note(client: TestClient) -> None:
    """The reason this is its own table.

    A day note is planning written beforehand and deleted once spent. If
    they shared a column, clearing "buy the JR Pass" would also erase what
    you wrote about the day it reminded you about.
    """
    trip_id = _trip(client)
    day = "2026-04-13"
    client.put(f"/api/trips/{trip_id}/days/{day}/note", json={"note": "buy the JR Pass"})
    _write(client, trip_id, day, "The pass queue took an hour but the day was lovely.")

    client.delete(f"/api/trips/{trip_id}/days/{day}/note")

    entries = client.get(f"/api/trips/{trip_id}/diary").json()
    assert len(entries) == 1
    assert "lovely" in entries[0]["text"]


def test_an_empty_entry_is_refused(client: TestClient) -> None:
    """Writing nothing is deleting, and deleting has its own verb."""
    trip_id = _trip(client)
    assert _write(client, trip_id, "2026-04-13", "").status_code == 422


def test_a_long_entry_is_accepted(client: TestClient) -> None:
    """This is the one field someone might write five hundred words into."""
    trip_id = _trip(client)
    assert _write(client, trip_id, "2026-04-13", "x" * 5000).status_code == 200


def test_an_absurdly_long_entry_is_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    assert _write(client, trip_id, "2026-04-13", "x" * 20_001).status_code == 422


def test_a_day_that_is_not_a_date_is_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    assert _write(client, trip_id, "yesterday").status_code == 422


def test_deleting_an_entry_removes_it(client: TestClient) -> None:
    trip_id = _trip(client)
    _write(client, trip_id, "2026-04-13")

    assert client.delete(f"/api/trips/{trip_id}/diary/2026-04-13").status_code == 204
    assert client.get(f"/api/trips/{trip_id}/diary").json() == []


def test_deleting_a_day_never_written_says_so(client: TestClient) -> None:
    trip_id = _trip(client)
    response = client.delete(f"/api/trips/{trip_id}/diary/2026-04-13")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "diary_entry_not_found"


def test_writing_to_a_trip_that_does_not_exist_says_so(client: TestClient) -> None:
    assert _write(client, str(uuid.uuid4()), "2026-04-13").status_code == 404


def test_one_trips_diary_is_not_anothers(client: TestClient) -> None:
    mine = _trip(client)
    yours = _trip(client)
    _write(client, mine, "2026-04-13", "mine")

    assert client.get(f"/api/trips/{yours}/diary").json() == []


def test_the_diary_travels_in_the_bundle(client: TestClient) -> None:
    """Reading back what you wrote must work in airplane mode, which means
    it has to arrive with everything else."""
    trip_id = _trip(client)
    _write(client, trip_id, "2026-04-13", "Ramen, then rain.")

    bundle = client.get(f"/api/trips/{trip_id}/bundle").json()

    assert [entry["day"] for entry in bundle["diary"]] == ["2026-04-13"]


def test_writing_the_diary_moves_the_bundle_etag(client: TestClient) -> None:
    """Otherwise the phone keeps being told nothing has changed, and what
    you wrote on the laptop never arrives."""
    trip_id = _trip(client)
    url = f"/api/trips/{trip_id}/bundle"
    before = client.get(url).headers["etag"]

    _write(client, trip_id, "2026-04-13")

    assert client.get(url).headers["etag"] != before


def test_deleting_a_trip_takes_its_diary_with_it(client: TestClient) -> None:
    trip_id = _trip(client)
    _write(client, trip_id, "2026-04-13")

    client.delete(f"/api/trips/{trip_id}")

    assert client.get(f"/api/trips/{trip_id}/diary").status_code == 404
