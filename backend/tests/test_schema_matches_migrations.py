"""The migrations and the models describe the same database.

The rest of the suite builds its schema with `Base.metadata.create_all`,
which proves the application works and says nothing about the migration
chain — and the chain is what runs against Neon on every deploy. A
migration that SQLite accepts can fail on PostgreSQL, or apply and leave
a different shape, and neither shows up until a deploy.

This runs only against a real database (`TEST_DATABASE_URL`), because on
SQLite the comparison is noise: it reports type differences for every
column, having no native types to compare against.
"""

import os

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

import app.models  # noqa: F401  every table has to be imported to be registered
from app.db import Base

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL.startswith("postgresql"),
    reason="needs a real PostgreSQL: make test-pg TEST_DATABASE_URL=…",
)


@pytest.fixture
def migrated_url() -> str:
    """A database built by running the chain from empty, and torn down after."""
    engine = create_engine(TEST_DATABASE_URL, isolation_level="AUTOCOMMIT")
    name = "endpoint_chain_check"
    with engine.connect() as connection:
        connection.execute(text(f'drop database if exists "{name}"'))
        connection.execute(text(f'create database "{name}"'))
    engine.dispose()

    # `make_url`, not string surgery: a socket-based URL carries its host
    # in the query string, so the last path segment is not the database —
    # cutting on the final slash renamed the socket directory instead, and
    # the connection then failed on a path that did not exist.
    yield make_url(TEST_DATABASE_URL).set(database=name).render_as_string(hide_password=False)

    engine = create_engine(TEST_DATABASE_URL, isolation_level="AUTOCOMMIT")
    with engine.connect() as connection:
        connection.execute(text(f'drop database if exists "{name}"'))
    engine.dispose()


def test_the_chain_applies_and_leaves_what_the_models_describe(migrated_url: str) -> None:
    config = Config("alembic.ini")
    # Doubled, because this goes through ConfigParser interpolation and a
    # socket path arrives percent-encoded — `%2F` is read as the start of
    # a substitution and raises before anything runs.
    config.set_main_option("sqlalchemy.url", migrated_url.replace("%", "%%"))
    command.upgrade(config, "head")

    engine = create_engine(migrated_url)
    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        differences = compare_metadata(context, Base.metadata)
    engine.dispose()

    # Alembic's own bookkeeping table is not in the models, by design.
    real = [item for item in differences if "alembic_version" not in repr(item)]
    assert real == [], (
        "The migrations and the models have drifted. Each entry below is "
        "something a deploy would leave wrong:\n  " + "\n  ".join(repr(item) for item in real)
    )
