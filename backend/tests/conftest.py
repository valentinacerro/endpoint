import os
from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, delete, event, inspect, text
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


#: Point this at a Postgres instance to run the same suite against the real
#: thing: SQLite silently differs on JSONB, bytea, TIMESTAMPTZ and NUMERIC,
#: so a green run here is not proof the deploy will behave.
#:     make test-pg TEST_DATABASE_URL=postgresql+psycopg://...
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")


@pytest.fixture(scope="session")
def engine() -> Generator[Engine]:
    if TEST_DATABASE_URL:
        db_engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    else:
        # StaticPool keeps a single shared connection; otherwise every session
        # would see a different, empty in-memory database.
        db_engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

        @event.listens_for(db_engine, "connect")
        def _enable_foreign_keys(dbapi_connection, _record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    _refuse_to_wipe_real_data(db_engine)

    Base.metadata.drop_all(db_engine)
    Base.metadata.create_all(db_engine)
    try:
        yield db_engine
    finally:
        Base.metadata.drop_all(db_engine)
        db_engine.dispose()


def _refuse_to_wipe_real_data(db_engine: Engine) -> None:
    """Stop the suite before it destroys a database someone cares about.

    This fixture drops every table. Pointed at the production database by a
    slip of the shell — `make test-pg TEST_DATABASE_URL=…` with the wrong
    string pasted in — that is the entire trip gone. Refusing when the target
    already holds trips costs one query and removes the possibility.

    Use a Neon branch for testing; creating one is instant and free.
    """
    if not TEST_DATABASE_URL:
        return

    inspector = inspect(db_engine)
    if "trip" not in inspector.get_table_names():
        return

    with db_engine.connect() as connection:
        existing = connection.execute(text("SELECT count(*) FROM trip")).scalar() or 0

    if existing:
        raise RuntimeError(
            f"{existing} trip(s) found in TEST_DATABASE_URL. This suite drops every table, "
            "so it refuses to run against a database with data in it. "
            "Point it at an empty database or a Neon branch."
        )


@pytest.fixture
def db_session(engine: Engine) -> Generator[Session]:
    """A session per test, with every row cleared afterwards.

    The tidier "wrap the test in a transaction and roll it back" recipe is
    not used here on purpose: it relies on savepoints, and pysqlite does not
    emit its own BEGIN, so on SQLite the outer transaction never really
    exists and the application's commits leak into the next test. Deleting
    the rows is blunter, but it behaves identically on SQLite and Postgres,
    which is the whole point of being able to run this suite on both.
    """
    maker = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = maker()
    try:
        yield session
    finally:
        session.rollback()
        # Reverse dependency order, so children go before their parents.
        for table in reversed(Base.metadata.sorted_tables):
            session.execute(delete(table))
        session.commit()
        session.close()


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
