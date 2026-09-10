"""Generate the Argon2id hash to put in APP_PASSWORD_HASH.

    uv run python -m app.hashpw

The password is typed blind (it never appears on screen and never reaches the
shell history) and only the hash is printed.
"""

import getpass
import secrets
import sys

from app.security import hash_password


def main() -> int:
    password = getpass.getpass("Access password: ")
    if len(password) < 12:
        print("Too short: use at least 12 characters.", file=sys.stderr)
        return 1
    if password != getpass.getpass("Repeat the password: "):
        print("The two passwords do not match.", file=sys.stderr)
        return 1

    print("\nPaste these two lines into your .env (and into Render's env vars):\n")
    print(f"APP_PASSWORD_HASH={hash_password(password)}")
    print(f"JWT_SECRET={secrets.token_urlsafe(48)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
