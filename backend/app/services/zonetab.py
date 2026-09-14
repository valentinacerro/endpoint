"""Which time zone a place is in, from its country and its position.

Picking "Tokyo" from the lookup used to fill in the name and the
coordinates and leave the zone reading `Europe/Rome`, and a stop's zone
is what decides which day its bookings land on. Nothing complained; the
itinerary was simply a day out, for the whole trip.

The answer is in the tz database itself. `zone.tab` lists every zone with
its country and the coordinates of its reference city, so a country with
one zone answers outright — 216 of 247 do, Japan among them — and a
country with several is answered by whichever reference city is nearest.
That is right for the cases a traveller meets (a stop in Los Angeles gets
America/Los_Angeles) and approximate near an internal boundary, which is
why the field stays editable and the screen says where the value came
from.

The table is generated rather than hand-written, by `scripts/make_zonetab.py`,
and vendored rather than read at runtime: the production image is
`python:3.13-slim`, which ships no zone database at all. `test_zonetab.py`
re-derives it from the system copy when there is one, so drift shows up
on a development machine rather than in a wrong itinerary.
"""

from math import cos, radians

from app.services.zonetab_data import ZONES


def zone_for(country: str | None, lat: float | None = None, lon: float | None = None) -> str | None:
    """The IANA zone for a place, or None when there is nothing to go on.

    None rather than a guess: a wrong zone is worse than an absent one,
    because an absent one is visible.
    """
    if not country:
        return None
    candidates = ZONES.get(country.strip().upper())
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0][0]
    if lat is None or lon is None:
        # Several zones and no position: the country alone cannot say.
        return None

    def distance(entry: tuple[str, float, float]) -> float:
        _, zlat, zlon = entry
        # Squared, because this only has to rank. The cosine narrows a
        # degree of longitude towards the poles, which is the correct
        # thing to do and — checked by sweeping every country with more
        # than one zone — changes the answer nowhere a person could be:
        # the only divergences are at coordinates like a United States
        # point in the Southern Ocean. Kept because the arithmetic is
        # right, not because it was measured to matter.
        dy = zlat - lat
        dx = (zlon - lon) * cos(radians((zlat + lat) / 2))
        return dy * dy + dx * dx

    return min(candidates, key=distance)[0]
