"""Importing a Google Takeout saved list."""

from fastapi.testclient import TestClient

from app.services.takeout import parse

PLACE_URL = "https://www.google.com/maps/place/Senso-ji/@35.7147,139.7966,17z"
CID_URL = "https://maps.google.com/?cid=12345678901234567890"
#: As a real CSV writes them: a Maps URL holds commas in its
#: @lat,lng,zoom part, so the field is quoted.
Q = f'"{PLACE_URL}"'
Q_CID = f'"{CID_URL}"'


def _trip(client: TestClient) -> str:
    return client.post("/api/trips", json={"title": "Japan"}).json()["id"]


def _upload(client: TestClient, trip_id: str, csv: str):
    return client.post(
        f"/api/trips/{trip_id}/places/import",
        files={"file": ("Saved Places.csv", csv.encode("utf-8"), "text/csv")},
    )


class TestParsing:
    def test_english_headers(self) -> None:
        rows = parse(f"Title,Note,URL\nSenso-ji,bello,{Q}\n".encode())
        assert rows[0].name == "Senso-ji"
        assert rows[0].note == "bello"
        assert rows[0].url == PLACE_URL

    def test_italian_headers(self) -> None:
        """Takeout translates its headers into the account's language, so
        matching on names alone would work only for accounts we guessed."""
        rows = parse(f"Titolo,Nota,URL\nSenso-ji,bello,{Q}\n".encode())
        assert rows[0].name == "Senso-ji"
        assert rows[0].note == "bello"

    def test_headers_in_a_language_nobody_listed(self) -> None:
        # The URL column is found by what it contains, and the name is the
        # first column that is not it.
        rows = parse(f"Naam,Opmerking,Koppeling\nSenso-ji,mooi,{Q}\n".encode())
        assert rows[0].name == "Senso-ji"
        assert rows[0].url == PLACE_URL

    def test_a_byte_order_mark_does_not_glue_itself_to_the_first_header(self) -> None:
        content = ("﻿" + f"Title,Note,URL\nSenso-ji,,{Q}\n").encode("utf-8")
        assert parse(content)[0].name == "Senso-ji"

    def test_rows_without_a_name_are_dropped(self) -> None:
        rows = parse(f"Title,URL\n,{Q}\nSenso-ji,{Q}\n".encode())
        assert [row.name for row in rows] == ["Senso-ji"]

    def test_a_file_with_no_rows_is_refused(self) -> None:
        import pytest

        from app.errors import AppError

        with pytest.raises(AppError) as raised:
            parse(b"Title,Note,URL\n")
        assert raised.value.code == "empty_csv"


def test_import_creates_places_and_reads_positions(client: TestClient) -> None:
    trip_id = _trip(client)
    csv = f"Title,Note,URL\nSenso-ji,da vedere,{Q}\nUn posto senza coordinate,,{Q_CID}\n"
    summary = _upload(client, trip_id, csv).json()

    assert summary["created"] == 2
    # A `cid` link carries no position, which is why the app offers to
    # resolve them afterwards rather than pretending they are all mapped.
    assert summary["with_position"] == 1
    assert summary["without_position"] == 1

    places = client.get(f"/api/trips/{trip_id}/places").json()
    by_name = {place["name"]: place for place in places}
    assert by_name["Senso-ji"]["lat"] == 35.7147
    assert by_name["Senso-ji"]["notes"] == "da vedere"
    assert by_name["Un posto senza coordinate"]["lat"] is None


def test_importing_the_same_list_twice_does_not_double_it(client: TestClient) -> None:
    trip_id = _trip(client)
    csv = f"Title,URL\nSenso-ji,{Q}\n"

    first = _upload(client, trip_id, csv).json()
    second = _upload(client, trip_id, csv).json()

    assert first["created"] == 1
    assert second["created"] == 0
    assert second["skipped"] == 1
    assert len(client.get(f"/api/trips/{trip_id}/places").json()) == 1


def test_a_place_from_import_keeps_its_link(client: TestClient) -> None:
    trip_id = _trip(client)
    _upload(client, trip_id, f"Title,URL\nSenso-ji,{Q}\n")
    assert client.get(f"/api/trips/{trip_id}/places").json()[0]["url"] == PLACE_URL


def test_a_file_that_is_not_a_csv_is_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    response = client.post(
        f"/api/trips/{trip_id}/places/import",
        files={"file": ("x.bin", b"\xff\xfe\x00\x01", "application/octet-stream")},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "not_utf8"
