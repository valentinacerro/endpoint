"""Moving many places at once, or none of them.

The day planner writes thirty of these. What matters is that a request
which cannot be applied in full is not applied at all: an itinerary half
rearranged, with no way to tell which half, is worse than one that
refused.
"""

import datetime as dt
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import make_place, make_stop, make_trip


def _schedule(client: TestClient, trip_id, **body):
    return client.post(f"/api/trips/{trip_id}/places/schedule", json=body)


def _entry(place_id, at="2026-04-13T10:00:00+09:00"):
    return {"id": str(place_id), "planned_start_at": at, "planned_tz": "Asia/Tokyo"}


def test_it_schedules_many_places_in_one_request(client: TestClient, db_session: Session) -> None:
    trip = make_trip(db_session)
    places = [make_place(db_session, trip) for _ in range(3)]

    response = _schedule(client, trip.id, scheduled=[_entry(place.id) for place in places])

    assert response.status_code == 200
    assert response.json() == {"created": 0, "scheduled": 3, "cleared": 0}
    stored = client.get(f"/api/trips/{trip.id}/places").json()
    assert all(place["planned_start_at"] for place in stored)


def test_it_returns_places_to_the_wish_list(client: TestClient, db_session: Session) -> None:
    trip = make_trip(db_session)
    place = make_place(db_session, trip)
    _schedule(client, trip.id, scheduled=[_entry(place.id)])

    response = _schedule(client, trip.id, cleared=[str(place.id)])

    assert response.json() == {"created": 0, "scheduled": 0, "cleared": 1}
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
    assert _schedule(client, trip.id).json() == {"created": 0, "scheduled": 0, "cleared": 0}


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


def test_it_creates_and_schedules_in_one_request(client: TestClient, db_session: Session) -> None:
    """The planner proposes places it found itself, and they have to exist
    before they can be given a time.

    Twenty separate PUTs was the first version, and it was wrong twice
    over: twenty round trips against a service that takes a minute to
    wake, and — if you walked away in the middle — some places saved with
    nothing scheduled. Applying a plan is one act.
    """
    trip = make_trip(db_session, start_date=dt.date(2026, 4, 11), end_date=dt.date(2026, 4, 18))
    stop = make_stop(
        db_session, trip, arrive_date=dt.date(2026, 4, 11), depart_date=dt.date(2026, 4, 18)
    )
    new_id = str(uuid.uuid4())

    response = client.post(
        f"/api/trips/{trip.id}/places/schedule",
        json={
            "created": [
                {
                    "id": new_id,
                    "name": "Senso-ji",
                    "category": "temple",
                    "stop_id": str(stop.id),
                    "lat": 35.7148,
                    "lon": 139.7967,
                }
            ],
            "scheduled": [
                {
                    "id": new_id,
                    "planned_start_at": "2026-04-12T00:30:00Z",
                    "planned_tz": "Asia/Tokyo",
                }
            ],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"created": 1, "scheduled": 1, "cleared": 0}

    place = client.get(f"/api/trips/{trip.id}/places/{new_id}").json()
    assert place["name"] == "Senso-ji"
    assert place["planned_tz"] == "Asia/Tokyo"
    # Derived from the category, like any other place.
    assert place["weather_exposure"] == "outdoor"


def test_replaying_the_whole_plan_leaves_one_of_each(
    client: TestClient, db_session: Session
) -> None:
    trip = make_trip(db_session, start_date=dt.date(2026, 4, 11), end_date=dt.date(2026, 4, 18))
    stop = make_stop(
        db_session, trip, arrive_date=dt.date(2026, 4, 11), depart_date=dt.date(2026, 4, 18)
    )
    new_id = str(uuid.uuid4())
    body = {
        "created": [
            {"id": new_id, "name": "Senso-ji", "category": "temple", "stop_id": str(stop.id)}
        ],
        "scheduled": [
            {
                "id": new_id,
                "planned_start_at": "2026-04-12T00:30:00Z",
                "planned_tz": "Asia/Tokyo",
            }
        ],
    }

    first = client.post(f"/api/trips/{trip.id}/places/schedule", json=body)
    second = client.post(f"/api/trips/{trip.id}/places/schedule", json=body)

    assert first.json()["created"] == 1
    # Already there the second time, so replaced rather than made again.
    assert second.json()["created"] == 0
    assert len(client.get(f"/api/trips/{trip.id}/places").json()) == 1


def test_nothing_is_kept_when_part_of_the_plan_is_refused(
    client: TestClient, db_session: Session
) -> None:
    """The place is created and the schedule then names an id that is not
    on this trip. Neither half may survive."""
    trip = make_trip(db_session, start_date=dt.date(2026, 4, 11), end_date=dt.date(2026, 4, 18))
    new_id = str(uuid.uuid4())

    response = client.post(
        f"/api/trips/{trip.id}/places/schedule",
        json={
            "created": [{"id": new_id, "name": "Senso-ji", "category": "temple"}],
            "scheduled": [
                {
                    "id": str(uuid.uuid4()),
                    "planned_start_at": "2026-04-12T00:30:00Z",
                    "planned_tz": "Asia/Tokyo",
                }
            ],
        },
    )
    assert response.status_code == 404
    assert client.get(f"/api/trips/{trip.id}/places").json() == []


def test_a_created_place_cannot_be_hung_on_another_trip_s_city(
    client: TestClient, db_session: Session
) -> None:
    trip = make_trip(db_session)
    other = make_trip(db_session, title="Portugal")
    elsewhere = make_stop(db_session, other, name="Lisbon", tz="Europe/Lisbon")

    response = client.post(
        f"/api/trips/{trip.id}/places/schedule",
        json={
            "created": [
                {
                    "id": str(uuid.uuid4()),
                    "name": "Belem",
                    "category": "sight",
                    "stop_id": str(elsewhere.id),
                }
            ]
        },
    )
    assert response.status_code == 404
    assert client.get(f"/api/trips/{trip.id}/places").json() == []
