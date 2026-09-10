from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings, get_settings
from app.db import Base, get_db
from app.limiter import limiter
from app.main import create_app
from app.security import hash_password

TEST_PASSWORD = "a-long-enough-test-password"


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings(
        env="dev",
        database_url="sqlite://",
        app_password_hash=hash_password(TEST_PASSWORD),
        jwt_secret="s" * 48,
    )


@pytest.fixture
def db_session() -> Generator[Session]:
    # StaticPool keeps a single shared connection; otherwise every session
    # would see a different, empty in-memory database.
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = maker()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def app(settings: Settings, db_session: Session) -> Generator[FastAPI]:
    # The rate limiter would make tests depend on their order and on how many
    # logins ran before them.
    limiter.enabled = False

    application = create_app(settings)
    application.dependency_overrides[get_settings] = lambda: settings
    application.dependency_overrides[get_db] = lambda: db_session
    try:
        yield application
    finally:
        application.dependency_overrides.clear()
        limiter.enabled = True


@pytest.fixture
def anon_client(app: FastAPI) -> Generator[TestClient]:
    """A client with no session."""
    with TestClient(app) as client:
        yield client


@pytest.fixture
def client(app: FastAPI) -> Generator[TestClient]:
    """An already authenticated client: the cookie persists on the HTTP session."""
    with TestClient(app) as test_client:
        response = test_client.post("/api/auth/login", json={"password": TEST_PASSWORD})
        assert response.status_code == 200, response.text
        yield test_client
