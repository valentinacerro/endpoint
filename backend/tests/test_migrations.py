"""Migrations must match the models, and must be reversible.

This catches the single most common solo-developer mistake: editing a model
and forgetting to generate the migration. Everything works locally, because
the local database was created from the models — and then the deploy runs
`alembic upgrade head` against a schema that never got the column.
"""

from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext

from app.db import Base, make_engine

BACKEND_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture
def alembic_config(tmp_path: Path) -> tuple[Config, str]:
    """Alembic pointed at a throwaway database file.

    A file rather than `:memory:` because Alembic opens its own connection,
    which would see an entirely separate empty in-memory database.
    """
    database_url = f"sqlite:///{tmp_path / 'migrations.db'}"
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config, database_url


def test_upgrade_downgrade_upgrade(alembic_config) -> None:
    config, database_url = alembic_config

    command.upgrade(config, "head")
    command.downgrade(config, "base")
    command.upgrade(config, "head")


def test_the_models_match_the_migrations(alembic_config) -> None:
    config, database_url = alembic_config

    command.upgrade(config, "head")

    engine = make_engine(database_url)
    try:
        with engine.connect() as connection:
            differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    finally:
        engine.dispose()

    assert not differences, (
        "the models and the migrations have drifted apart — "
        f'run `make revision m="..."`: {differences}'
    )
