"""Uploading, serving and deleting travel documents."""

import hashlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings, get_settings

PDF = b"%PDF-1.4\n" + b"voucher content " * 8
PNG = b"\x89PNG\r\n\x1a\n" + b"pixels" * 8


def _trip(client: TestClient) -> str:
    return client.post("/api/trips", json={"title": "Japan"}).json()["id"]


def _upload(
    client: TestClient,
    trip_id: str,
    *,
    data: bytes = PDF,
    name: str = "voucher.pdf",
    declared: str = "application/pdf",
    **fields,
):
    return client.post(
        f"/api/trips/{trip_id}/attachments",
        files={"file": (name, data, declared)},
        data=fields,
    )


def test_upload_then_download(client: TestClient) -> None:
    trip_id = _trip(client)
    created = _upload(client, trip_id, kind="voucher")
    assert created.status_code == 201, created.text

    meta = created.json()
    assert meta["byte_size"] == len(PDF)
    assert meta["sha256"] == hashlib.sha256(PDF).hexdigest()
    assert meta["content_type"] == "application/pdf"
    assert meta["kind"] == "voucher"
    assert meta["trip_id"] == trip_id

    downloaded = client.get(f"/api/trips/{trip_id}/attachments/{meta['id']}/file")
    assert downloaded.status_code == 200
    assert downloaded.content == PDF
    assert downloaded.headers["content-type"] == "application/pdf"
    assert downloaded.headers["etag"] == f'"{meta["sha256"]}"'
    assert "inline" in downloaded.headers["content-disposition"]
    assert downloaded.headers["x-content-type-options"] == "nosniff"


def test_the_stored_type_comes_from_the_bytes_not_the_client(client: TestClient) -> None:
    """A browser will label a file anything, and on some platforms sends
    application/octet-stream for an ordinary PDF."""
    trip_id = _trip(client)
    lying = _upload(client, trip_id, data=PDF, name="voucher.pdf", declared="image/png")
    assert lying.status_code == 201
    assert lying.json()["content_type"] == "application/pdf"


def test_an_unsupported_file_is_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    response = _upload(
        client, trip_id, data=b"#!/bin/sh\nrm -rf /", name="script.sh", declared="application/pdf"
    )
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_file_type"


def test_an_empty_file_is_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    response = _upload(client, trip_id, data=b"", name="empty.pdf")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "empty_file"


def test_a_file_over_the_cap_is_refused(app: FastAPI, client: TestClient) -> None:
    small = Settings(
        env="dev",
        database_url="sqlite://",
        app_password_hash="$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA",
        jwt_secret="s" * 48,
        max_upload_bytes=1_000,
    )
    trip_id = _trip(client)
    app.dependency_overrides[get_settings] = lambda: small

    response = _upload(client, trip_id, data=b"%PDF-1.4\n" + b"x" * 2_000)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"


def test_uploading_the_same_file_twice_does_not_duplicate_it(client: TestClient) -> None:
    """Tapping upload twice on a slow connection is the ordinary case."""
    trip_id = _trip(client)
    first = _upload(client, trip_id).json()
    second = _upload(client, trip_id).json()

    assert first["id"] == second["id"]
    assert len(client.get(f"/api/trips/{trip_id}/attachments").json()) == 1


def test_the_same_file_on_different_owners_is_kept_separately(client: TestClient) -> None:
    trip_id = _trip(client)
    booking = client.post(
        f"/api/trips/{trip_id}/bookings", json={"kind": "hotel", "title": "Gracery"}
    ).json()

    on_trip = _upload(client, trip_id).json()
    on_booking = _upload(client, trip_id, booking_id=booking["id"]).json()

    assert on_trip["id"] != on_booking["id"]
    assert on_booking["trip_id"] is None
    assert on_booking["booking_id"] == booking["id"]


def test_an_empty_owner_field_is_treated_as_absent(client: TestClient) -> None:
    """A real HTML form posts "" for a field the user never touched."""
    trip_id = _trip(client)
    response = _upload(client, trip_id, stop_id="", booking_id="")
    assert response.status_code == 201
    assert response.json()["trip_id"] == trip_id


def test_two_owners_at_once_are_refused(client: TestClient) -> None:
    trip_id = _trip(client)
    stop = client.post(
        f"/api/trips/{trip_id}/stops", json={"name": "Tokyo", "tz": "Asia/Tokyo"}
    ).json()
    booking = client.post(
        f"/api/trips/{trip_id}/bookings", json={"kind": "hotel", "title": "Gracery"}
    ).json()

    response = _upload(client, trip_id, stop_id=stop["id"], booking_id=booking["id"])
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "ambiguous_owner"


def test_a_cached_file_answers_304(client: TestClient) -> None:
    trip_id = _trip(client)
    meta = _upload(client, trip_id).json()
    url = f"/api/trips/{trip_id}/attachments/{meta['id']}/file"

    etag = client.get(url).headers["etag"]
    again = client.get(url, headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""


def test_a_japanese_filename_survives_the_header(client: TestClient) -> None:
    """A perfectly normal name for a hotel voucher, and one a bare
    `filename=` parameter cannot carry."""
    trip_id = _trip(client)
    meta = _upload(client, trip_id, data=PNG, name="受領書.png").json()
    assert meta["filename"] == "受領書.png"

    disposition = client.get(f"/api/trips/{trip_id}/attachments/{meta['id']}/file").headers[
        "content-disposition"
    ]
    assert "filename*=UTF-8''" in disposition


def test_a_path_in_the_filename_is_stripped(client: TestClient) -> None:
    trip_id = _trip(client)
    meta = _upload(client, trip_id, name="../../etc/passwd.pdf").json()
    assert meta["filename"] == "passwd.pdf"


def test_a_document_cannot_be_reached_through_another_trip(client: TestClient) -> None:
    first = _trip(client)
    second = _trip(client)
    meta = _upload(client, first).json()

    response = client.get(f"/api/trips/{second}/attachments/{meta['id']}/file")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "attachment_not_found"


def test_deleting_a_document_removes_it(client: TestClient) -> None:
    trip_id = _trip(client)
    meta = _upload(client, trip_id).json()

    assert client.delete(f"/api/trips/{trip_id}/attachments/{meta['id']}").status_code == 204
    assert client.get(f"/api/trips/{trip_id}/attachments/{meta['id']}/file").status_code == 404
    assert client.get(f"/api/trips/{trip_id}/attachments").json() == []
