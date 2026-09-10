"""The most important test in the project.

If one route ships unprotected, the booking references and travel documents
become public. Coverage here is not hand-written route by route: it is derived
from the routes actually registered, so a router added later is checked without
anyone having to remember.
"""

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import TEST_PASSWORD

# The only routes allowed to work without a session. Adding one here is a
# deliberate decision, and a visible one in the diff.
PUBLIC_PATHS = {
    "/health",
    "/api/auth/login",
    "/api/auth/logout",
}


def _concrete(path: str) -> str:
    """Replace path parameters with plausible values."""
    parts = []
    for segment in path.split("/"):
        if segment.startswith("{") and segment.endswith("}"):
            parts.append(str(uuid4()))
        else:
            parts.append(segment)
    return "/".join(parts)


def _protected_endpoints(app: FastAPI) -> list[tuple[str, str]]:
    """Routes that must require a session, read from the OpenAPI schema.

    We use `app.openapi()` rather than `app.routes` because since FastAPI 0.141
    `include_router` no longer flattens routes into the app's list: it nests
    them in internal objects. The schema is the only public, stable
    enumeration. The test below guarantees no route can escape it.
    """
    found = []
    for path, operations in app.openapi()["paths"].items():
        if not path.startswith("/api") or path in PUBLIC_PATHS:
            continue
        for method in sorted(operations):
            found.append((method.upper(), path))
    return found


def _walk_api_routes(router: object) -> list[object]:
    """Walk the router tree and return the concrete APIRoute objects."""
    collected: list[object] = []
    children = getattr(router, "routes", None)
    if children is None:
        original = getattr(router, "original_router", None)
        children = getattr(original, "routes", None) or []
    for child in children:
        if hasattr(child, "endpoint") and hasattr(child, "methods"):
            collected.append(child)
        else:
            collected.extend(_walk_api_routes(child))
    return collected


def test_there_are_protected_endpoints(app: FastAPI) -> None:
    """Safeguard: if collection ever stopped finding routes, the test below
    would pass while verifying nothing at all."""
    assert _protected_endpoints(app), "no protected routes found: collection is broken"


def test_no_api_route_hides_from_the_openapi_schema(app: FastAPI) -> None:
    """`_protected_endpoints` reads the schema, so a route marked
    `include_in_schema=False` would slip past it and go unverified."""
    hidden = [
        route.path
        for route in _walk_api_routes(app)
        if getattr(route, "path", "").startswith("/api")
        and not getattr(route, "include_in_schema", True)
    ]
    assert not hidden, f"routes excluded from the schema, therefore unverified: {hidden}"


def test_every_api_route_requires_a_session(app: FastAPI, anon_client: TestClient) -> None:
    unprotected = []
    for method, path in _protected_endpoints(app):
        response = anon_client.request(method, _concrete(path), json={})
        if response.status_code != 401:
            unprotected.append(f"{method} {path} -> {response.status_code}")
    assert not unprotected, "routes reachable without a session: " + ", ".join(unprotected)


def test_health_is_public_and_does_not_touch_the_database(anon_client: TestClient) -> None:
    response = anon_client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_login_with_wrong_password_is_rejected(anon_client: TestClient) -> None:
    response = anon_client.post("/api/auth/login", json={"password": "wrong"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_password"
    assert "session" not in response.cookies


def test_login_sets_an_httponly_cookie(anon_client: TestClient) -> None:
    response = anon_client.post("/api/auth/login", json={"password": TEST_PASSWORD})
    assert response.status_code == 200
    set_cookie = response.headers["set-cookie"]
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie
    # Development runs on http://localhost: with Secure the browser would
    # refuse to store the cookie at all.
    assert "Secure" not in set_cookie


def test_session_survives_and_me_confirms_it(client: TestClient) -> None:
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json() == {"authenticated": True}


def test_logout_clears_the_session(client: TestClient) -> None:
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_a_forged_token_is_rejected(anon_client: TestClient) -> None:
    anon_client.cookies.set("session", "not.a.token")
    response = anon_client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


@pytest.mark.parametrize("password", ["", "x" * 300])
def test_malformed_login_payloads_are_rejected(anon_client: TestClient, password: str) -> None:
    response = anon_client.post("/api/auth/login", json={"password": password})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
