"""Travel times you looked up yourself.

Everything else in the app estimates a journey from a straight line. That
is within a few per cent on distance and systematically long on time,
because no straight line knows whether a railway joins two points. There
is no free way to fix that for Japan, so the fix is a number you checked
once — and the point of these tests is that it is remembered exactly, and
found again by a leg that arrived from somewhere else.
"""

import uuid

from fastapi.testclient import TestClient

from tests.factories import make_trip

SENSOJI = (35.7148, 139.7967)
SHIBUYA = (35.6595, 139.7006)


def leg(a: tuple[float, float], b: tuple[float, float], minutes: int) -> dict:
    return {
        "from_lat": a[0],
        "from_lon": a[1],
        "to_lat": b[0],
        "to_lon": b[1],
        "minutes": minutes,
    }


def test_a_corrected_leg_is_kept(client: TestClient, db_session) -> None:
    trip = make_trip(db_session)
    response = client.put(f"/api/trips/{trip.id}/travel-times", json=leg(SENSOJI, SHIBUYA, 35))
    assert response.status_code == 200, response.text
    assert response.json()["minutes"] == 35


def test_writing_it_again_replaces_rather_than_duplicating(client: TestClient, db_session) -> None:
    # The offline queue can send the same write twice; that must not leave
    # two answers for one leg.
    trip = make_trip(db_session)
    client.put(f"/api/trips/{trip.id}/travel-times", json=leg(SENSOJI, SHIBUYA, 35))
    again = client.put(f"/api/trips/{trip.id}/travel-times", json=leg(SENSOJI, SHIBUYA, 40))
    assert again.status_code == 200
    assert again.json()["minutes"] == 40

    bundle = client.get(f"/api/trips/{trip.id}/bundle").json()
    assert len(bundle["travel_times"]) == 1


def test_the_same_place_from_another_source_finds_the_correction(
    client: TestClient, db_session
) -> None:
    """The reason coordinates are rounded before being stored.

    Two geocoders put the same temple a few metres apart. Without
    rounding, the correction typed for one would never be found by the
    other, and the app would silently go back to estimating.
    """
    trip = make_trip(db_session)
    client.put(f"/api/trips/{trip.id}/travel-times", json=leg(SENSOJI, SHIBUYA, 35))

    nudged = (SENSOJI[0] + 0.00002, SENSOJI[1] - 0.00003)
    again = client.put(f"/api/trips/{trip.id}/travel-times", json=leg(nudged, SHIBUYA, 35))

    bundle = client.get(f"/api/trips/{trip.id}/bundle").json()
    assert len(bundle["travel_times"]) == 1, "the nudged leg made a second row"
    assert again.json()["minutes"] == 35


def test_a_genuinely_different_place_gets_its_own_row(client: TestClient, db_session) -> None:
    # Half a kilometre away is a different journey, not a rounding error.
    trip = make_trip(db_session)
    client.put(f"/api/trips/{trip.id}/travel-times", json=leg(SENSOJI, SHIBUYA, 35))
    other = (SENSOJI[0] + 0.005, SENSOJI[1])
    client.put(f"/api/trips/{trip.id}/travel-times", json=leg(other, SHIBUYA, 30))

    bundle = client.get(f"/api/trips/{trip.id}/bundle").json()
    assert len(bundle["travel_times"]) == 2


def test_the_other_direction_is_its_own_journey(client: TestClient, db_session) -> None:
    # Up to a temple and back down are not the same walk.
    trip = make_trip(db_session)
    client.put(f"/api/trips/{trip.id}/travel-times", json=leg(SENSOJI, SHIBUYA, 35))
    client.put(f"/api/trips/{trip.id}/travel-times", json=leg(SHIBUYA, SENSOJI, 38))

    bundle = client.get(f"/api/trips/{trip.id}/bundle").json()
    assert len(bundle["travel_times"]) == 2


def test_it_can_be_forgotten_and_the_estimate_comes_back(client: TestClient, db_session) -> None:
    trip = make_trip(db_session)
    url = f"/api/trips/{trip.id}/travel-times"
    made = client.put(url, json=leg(SENSOJI, SHIBUYA, 35)).json()
    assert client.delete(f"{url}/{made['id']}").status_code == 204
    assert client.get(f"/api/trips/{trip.id}/bundle").json()["travel_times"] == []


def test_an_impossible_time_is_refused(client: TestClient, db_session) -> None:
    trip = make_trip(db_session)
    assert (
        client.put(f"/api/trips/{trip.id}/travel-times", json=leg(SENSOJI, SHIBUYA, -5)).status_code
        == 422
    )
    assert (
        client.put(
            f"/api/trips/{trip.id}/travel-times", json=leg(SENSOJI, SHIBUYA, 5000)
        ).status_code
        == 422
    )


def test_zero_is_allowed_because_two_things_share_a_building(
    client: TestClient, db_session
) -> None:
    trip = make_trip(db_session)
    assert (
        client.put(f"/api/trips/{trip.id}/travel-times", json=leg(SENSOJI, SENSOJI, 0)).status_code
        == 200
    )


def test_another_trip_cannot_be_written_to(client: TestClient, db_session) -> None:
    assert (
        client.put(
            f"/api/trips/{uuid.uuid4()}/travel-times", json=leg(SENSOJI, SHIBUYA, 35)
        ).status_code
        == 404
    )
