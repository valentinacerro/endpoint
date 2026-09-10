"""The migration history must stay intact.

A deployed database records the revision it last applied. Deleting or
rewriting that revision — which is exactly what regenerating an "initial"
migration does — leaves production unable to find where it is, and it
refuses to start with `Can't locate revision`. That happened once here;
these tests exist so it cannot happen quietly again.
"""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parent.parent


def _scripts() -> ScriptDirectory:
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    return ScriptDirectory.from_config(config)


def test_there_is_exactly_one_head() -> None:
    """Two heads mean two people added a migration on the same parent, and
    `upgrade head` becomes ambiguous."""
    heads = _scripts().get_heads()
    assert len(heads) == 1, f"expected one head, found {heads}"


def test_every_revision_points_at_one_that_exists() -> None:
    scripts = _scripts()
    known = {revision.revision for revision in scripts.walk_revisions()}
    for revision in scripts.walk_revisions():
        parent = revision.down_revision
        if parent is None:
            continue
        parents = parent if isinstance(parent, tuple) else (parent,)
        for one in parents:
            assert one in known, f"{revision.revision} descends from missing {one}"


def test_the_chain_reaches_a_single_base() -> None:
    """One root, so the whole history is walkable from an empty database."""
    bases = _scripts().get_bases()
    assert len(bases) == 1, f"expected one base, found {bases}"
