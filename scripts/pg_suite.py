"""Run the backend suite against a real PostgreSQL, with nothing installed.

    python3 scripts/pg_suite.py [pytest args]

The suite runs on SQLite by default, which is fast and wrong in the ways
that matter for a deploy: it has no native date or interval types, it does
not enforce most constraints, and it never sees the migration chain,
because the fixtures build the schema with `create_all`.

`pgserver` ships a self-contained PostgreSQL as a wheel, so this needs no
Docker, no Homebrew and no service running. It is not a dependency of the
backend: it has no wheel for Python 3.13, which the project requires, so
it lives in a throwaway environment this script builds on first use.

Everything is torn down afterwards, including the server.
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
VENV = ROOT / ".pg-venv"
RUNNER = VENV / "runner.py"

RUNNER_SOURCE = '''
import os, pathlib, subprocess, sys, tempfile
import pgserver

data = pathlib.Path(tempfile.mkdtemp()) / "pgdata"
server = pgserver.get_server(data)
try:
    server.psql("create database endpoint_test;")
    url = f"postgresql+psycopg://postgres@/endpoint_test?host={data}"
    print(f"postgres {server.psql('show server_version;').strip().splitlines()[-1].strip()}"
          " — running the suite\\n", flush=True)
    code = subprocess.run(
        ["uv", "run", "pytest", "-q", "--no-header", "-p", "no:cacheprovider", *sys.argv[2:]],
        cwd=sys.argv[1],
        env={**os.environ, "TEST_DATABASE_URL": url},
    ).returncode
finally:
    server.cleanup()
sys.exit(code)
'''


def ensure_venv() -> pathlib.Path:
    python = VENV / "bin" / "python"
    if not python.exists():
        print("building the throwaway environment (once)…", flush=True)
        # 3.12: pgserver publishes no wheel for 3.13 yet.
        subprocess.run(["uv", "venv", "--python", "3.12", str(VENV)], check=True)
        subprocess.run(
            ["uv", "pip", "install", "--python", str(python), "pgserver"],
            check=True,
        )
    RUNNER.write_text(RUNNER_SOURCE)
    return python


def main() -> None:
    python = ensure_venv()
    sys.exit(
        subprocess.run([str(python), str(RUNNER), str(BACKEND), *sys.argv[1:]]).returncode
    )


if __name__ == "__main__":
    main()
