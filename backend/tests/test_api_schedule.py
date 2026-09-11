"""Moving many places at once, or none of them.

The day planner writes thirty of these. What matters is that a request
which cannot be applied in full is not applied at all: an itinerary half
rearranged, with no way to tell which half, is worse than one that
refused.
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import make_place, make_trip


def _schedule(client: TestClient, trip_id, **body):
    return client.post(f"/api/trips/{trip_id}/places/schedule", json=body)


def _entry(place_id, at="2026-04-13T10:00:00+09:00"):
    return {"id": str(place_id), "planned_start_at": at, "planned_tz": "Asia/Tokyo"}


def test_it_schedules_many_places_in_one_request(client: TestClient, db_session: Session) -> None:
    trip = make_trip(db_session)
    places = [make_place(db_session, trip) for _ in range(3)]

    response = _schedule(client, trip.id, scheduled=[_entry(place.id) for place in places])

    assert response.status_code == 200
    assert response.json() == {"scheduled": 3, "cleared": 0}
    stored = client.get(f"/api/trips/{trip.id}/places").json()
    assert all(place["planned_start_at"] for place in stored)


def test_it_returns_places_to_the_wish_list(client: TestClient, db_session: Session) -> None:
    trip = make_trip(db_session)
    place = make_place(db_session, trip)
    _schedule(client, trip.id, scheduled=[_entry(place.id)])

    response = _schedule(client, trip.id, cleared=[str(place.id)])

    assert response.json() == {"scheduled": 0, "cleared": 1}
    assert client.get(f"/api/trips/{trip.id}/places").json()[0]["planned_start_at"] is None


def test_one_stranger_refuses_the_whole_request(client: TestClient, db_session: Session) -> None:
    """The property the planner depends on. Thirty visits applied and one
    refused would leave an itinerary nobody could reason about."""
    trip = make_trip(db_session)
    other = make_trip(db_session, title="Another trip")
    mine = make_place(db_session, trip)
    theirs = make_place(db_session, other)

    response = _schedule(client, trip.id, scheduled=[_entry(mine.id), _entry(theirs.id)])

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "place_not_found"
    # And nothing was written, not even the one that was fine.
    assert client.get(f"/api/trips/{trip.id}/places").json()[0]["planned_start_at"] is None


def test_a_place_that_does_not_exist_refuses_the_request(
    client: TestClient, db_session: Session
) -> None:
    trip = make_trip(db_session)
    place = make_place(db_session, trip)

    response = _schedule(client, trip.id, scheduled=[_entry(place.id), _entry(uuid.uuid4())])

    assert response.status_code == 404
    assert client.get(f"/api/trips/{trip.id}/places").json()[0]["planned_start_at"] is None


def test_the_same_place_twice_is_refused(client: TestClient, db_session: Session) -> None:
    """Two instants for one place is a caller bug, and silently applying
    whichever came last would hide it."""
    trip = make_trip(db_session)
    place = make_place(db_session, trip)

    response = _schedule(
        client,
        trip.id,
        scheduled=[_entry(place.id, "2026-04-13T10:00:00+09:00")],
        cleared=[str(place.id)],
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "place_listed_twice"


def test_a_naive_instant_is_refused(client: TestClient, db_session: Session) -> None:
    trip = make_trip(db_session)
    place = make_place(db_session, trip)
    response = _schedule(client, trip.id, scheduled=[_entry(place.id, "2026-04-13T10:00:00")])
    assert response.status_code == 422


def test_a_missing_zone_is_refused(client: TestClient, db_session: Session) -> None:
    """The database CHECK says an instant needs a zone; so does the
    single-place PATCH. This route must not be the way around it."""
    trip = make_trip(db_session)
    place = make_place(db_session, trip)
    response = _schedule(
        client,
        trip.id,
        scheduled=[
            {
                "id": str(place.id),
                "planned_start_at": "2026-04-13T10:00:00+09:00",
                "planned_tz": "",
            }
        ],
    )
    assert response.status_code == 422


def test_an_empty_request_is_harmless(client: TestClient, db_session: Session) -> None:
    trip = make_trip(db_session)
    assert _schedule(client, trip.id).json() == {"scheduled": 0, "cleared": 0}


def test_a_trip_that_does_not_exist_says_so(client: TestClient) -> None:
    assert _schedule(client, uuid.uuid4()).status_code == 404


def test_too_many_at_once_is_refused(client: TestClient, db_session: Session) -> None:
    trip = make_trip(db_session)
    entries = [_entry(uuid.uuid4()) for _ in range(501)]
    assert _schedule(client, trip.id, scheduled=entries).status_code == 422


def test_schedule_is_not_read_as_a_place_id(client: TestClient, db_session: Session) -> None:
    """The route is declared before /{place_id}. Declared after, the word
    "schedule" would be parsed as a uuid and answer 422 for ever."""
    trip = make_trip(db_session)
    assert _schedule(client, trip.id).status_code == 200
