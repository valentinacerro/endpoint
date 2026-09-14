"""Start the real application for the end-to-end run, on a throwaway database.

Serves the built frontend from `backend/app/static`, exactly as production
does: one origin, first-party cookies, no CORS and no dev server — so what
the browser meets is what a phone meets.
"""

import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
BACKEND = ROOT / "backend"

#: The password the spec types. Hashed here rather than committed, so
#: there is no credential in the repository even a worthless one — this
#: database lives for the length of one run and holds nothing.
PASSWORD = "walkthrough"

port = sys.argv[1] if len(sys.argv) > 1 else "8911"
db = pathlib.Path(tempfile.mkdtemp()) / "e2e.db"

hashed = subprocess.run(
    ["uv", "run", "python", "-c", f"from app.security import hash_password; print(hash_password({PASSWORD!r}))"],
    cwd=BACKEND,
    capture_output=True,
    text=True,
    check=True,
).stdout.strip()

env = {
    **os.environ,
    "ENV": "dev",
    "DATABASE_URL": f"sqlite+pysqlite:///{db}",
    "APP_PASSWORD_HASH": hashed,
    "SECRET_KEY": "e2e-only-not-a-secret",
}

# Build first, and refuse to run on a stale bundle.
#
# This is not belt-and-braces. The server hands the browser whatever sits
# in backend/app/static, so a build that failed leaves the previous one
# there and the walkthrough passes while testing code that is no longer
# in the repository — which is exactly what happened the first time a
# sabotage was tried against it, and the sabotage "passed".
build = subprocess.run(["npm", "run", "build"], cwd=ROOT / "frontend")
if build.returncode != 0:
    sys.exit("the frontend did not build — refusing to walk through a stale one")

subprocess.run(["uv", "run", "alembic", "upgrade", "head"], cwd=BACKEND, env=env, check=True)
sys.exit(
    subprocess.run(
        ["uv", "run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", port],
        cwd=BACKEND,
        env=env,
    ).returncode
)
