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

    password_hash = hash_password(password)
    jwt_secret = secrets.token_urlsafe(48)

    # Printed twice, in the two shapes they are actually needed in. A single
    # `NAME=value` line invites pasting the whole thing into a dashboard's
    # value box, where it becomes part of the secret and the app refuses to
    # start with a puzzling error.
    print("\n--- for backend/.env: paste both lines ---\n")
    print(f"APP_PASSWORD_HASH={password_hash}")
    print(f"JWT_SECRET={jwt_secret}")

    print("\n--- for Render: paste each value on its own, without the name ---\n")
    print(f"  APP_PASSWORD_HASH  ->  {password_hash}")
    print(f"  JWT_SECRET         ->  {jwt_secret}")
    print("\nCopy only what follows the arrow. Keep the password itself in a")
    print("password manager: there is no recovery, only regenerating this.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
