"""Alembic configuration.

The database URL comes from our Settings (so from .env locally and from
environment variables on Render), not from alembic.ini: one place to change,
and no credentials in a version-controlled file.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import JSON

import app.models  # noqa: F401  registers the models on Base.metadata
from app.config import get_settings
from app.db import Base, make_engine
from app.models.base import UtcDateTime

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
settings = get_settings()


def database_url() -> str:
    """Where to run the migrations.

    Normally our own settings, so there is a single source of truth and no
    credentials in a version-controlled file. An explicit `sqlalchemy.url`
    overrides it, which is how the test suite points migrations at a
    throwaway database instead of the development one.
    """
    return config.get_main_option("sqlalchemy.url") or settings.database_url


def render_item(type_: str, obj: object, autogen_context) -> str | bool:
    """Teach autogenerate how to write our custom column types.

    Without this, Alembic emits `app.models.base.UtcDateTime(...)` without
    importing `app`, and `astext_type=Text()` without qualifying `Text` — both
    of which raise NameError the moment the migration runs. Fixing it here
    rather than by hand means every future migration comes out correct.
    """
    if type_ != "type":
        return False

    if isinstance(obj, UtcDateTime):
        autogen_context.imports.add("from app.models.base import UtcDateTime")
        return "UtcDateTime()"

    if isinstance(obj, JSON):
        autogen_context.imports.add("from sqlalchemy.dialects import postgresql")
        return "sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql')"

    return False


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        render_item=render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = database_url()
    connectable = make_engine(url)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            render_item=render_item,
            # SQLite cannot ALTER TABLE, so batch mode recreates the table.
            # Only needed in development; on Postgres it is counterproductive.
            render_as_batch=url.startswith("sqlite"),
        )
        with context.begin_transaction():
            context.run_migrations()

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
