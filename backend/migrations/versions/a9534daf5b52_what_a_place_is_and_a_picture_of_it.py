"""what a place is, and a picture of it

Two columns the suggestions already had and lost on the way in: a place
proposed by the app arrived with a one-line description from Wikidata and
a photograph, and the moment you accepted it both were thrown away.

Separate from `notes`, which is yours. A sentence the app fetched and a
sentence you wrote are different things, and keeping the first in the
field meant for the second would make it impossible to refresh one
without destroying the other.

Both nullable, and most rows will keep them null for ever: a place typed
by hand or pasted from a Maps link has neither, and inventing one would
be worse than the blank.

Revision ID: a9534daf5b52
Revises: 76e4204f8f96
Create Date: 2026-09-14

"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a9534daf5b52"
down_revision: str | Sequence[str] | None = "76e4204f8f96"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("place", schema=None) as batch_op:
        batch_op.add_column(sa.Column("description", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("image_url", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("place", schema=None) as batch_op:
        batch_op.drop_column("image_url")
        batch_op.drop_column("description")
