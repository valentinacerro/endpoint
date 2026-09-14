"""what kind of day you want it to be

A shopping day, a museums day, a day spent outside. Without it the
planner has one idea of a good day — the nearest well-known things,
whatever they are — so a fortnight comes out as fourteen days of the same
shape.

On `day_note` rather than in a table of its own: a note and a theme are
both things you have said about one day, addressed the same way, one per
day. Nullable, because most days will never have one and "mixed" is the
honest name for that rather than a default anybody chose.

Revision ID: 6723e47fe481
Revises: a9534daf5b52
Create Date: 2026-09-14 17:52:50.264576

"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6723e47fe481"
down_revision: str | Sequence[str] | None = "a9534daf5b52"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("day_note", schema=None) as batch_op:
        batch_op.add_column(sa.Column("theme", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("day_note", schema=None) as batch_op:
        batch_op.drop_column("theme")
