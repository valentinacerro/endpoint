"""Which zone a stop is in.

The bug this answers was invisible: picking "Tokyo" from the lookup
filled in the name and the coordinates and left the zone reading
`Europe/Rome`. A stop's zone decides which day its bookings land on, so
the whole itinerary was a day out and nothing said so.
"""

import pathlib
import zoneinfo

import pytest

from app.services.zonetab import zone_for
from app.services.zonetab_data import ZONES


class TestAnswering:
    def test_a_country_with_one_zone_answers_without_a_position(self) -> None:
        assert zone_for("JP") == "Asia/Tokyo"
        assert zone_for("IT") == "Europe/Rome"
        assert zone_for("TH") == "Asia/Bangkok"

    def test_the_code_may_be_written_any_way(self) -> None:
        assert zone_for("jp") == zone_for(" JP ") == "Asia/Tokyo"

    def test_a_country_with_several_picks_the_nearest_reference_city(self) -> None:
        assert zone_for("US", 34.05, -118.24) == "America/Los_Angeles"
        assert zone_for("US", 40.71, -74.00) == "America/New_York"
        assert zone_for("AU", -33.87, 151.21) == "Australia/Sydney"
        # The islands, which are what a country-only guess gets wrong.
        assert zone_for("ES", 28.10, -15.40) == "Atlantic/Canary"
        assert zone_for("ES", 40.42, -3.70) == "Europe/Madrid"

    def test_it_reaches_the_far_corners_of_a_wide_country(self) -> None:
        assert zone_for("US", 61.22, -149.90) == "America/Anchorage"
        assert zone_for("US", 21.31, -157.86) == "Pacific/Honolulu"

    def test_several_zones_and_no_position_is_no_answer(self) -> None:
        # A guess here is worse than a blank: a wrong zone is invisible.
        assert zone_for("US") is None

    def test_an_unknown_or_absent_country_is_no_answer(self) -> None:
        assert zone_for("XX", 0, 0) is None
        assert zone_for(None, 35.68, 139.76) is None
        assert zone_for("", 35.68, 139.76) is None


class TestTheTableItself:
    def test_every_zone_named_is_one_python_can_load(self) -> None:
        # A typo here would be a stop that cannot be formatted at all.
        for entries in ZONES.values():
            for zone, _, _ in entries:
                zoneinfo.ZoneInfo(zone)

    def test_the_countries_a_trip_is_likely_to_touch_are_present(self) -> None:
        for code in ("JP", "IT", "FR", "ES", "US", "GB", "DE", "TH", "KR", "PT", "CH", "AT"):
            assert code in ZONES, code

    def test_it_matches_the_system_database_where_there_is_one(self) -> None:
        """Drift shows up on a development machine, not in an itinerary.

        The table is vendored because the production image ships no zone
        database at all, which means nothing else would ever notice that
        the tz database had moved on.
        """
        tab = None
        for base in (*zoneinfo.TZPATH, "/usr/share/zoneinfo"):
            for name in ("zone1970.tab", "zone.tab"):
                candidate = pathlib.Path(base) / name
                if candidate.exists():
                    tab = candidate
                    break
            if tab:
                break
        if tab is None:
            pytest.skip("no system tz database on this machine")

        import sys

        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))
        from make_zonetab import build

        fresh = build()
        assert set(fresh) == set(ZONES), "run scripts/make_zonetab.py"
        for code, entries in fresh.items():
            assert [z for z, _, _ in entries] == [z for z, _, _ in ZONES[code]], code
