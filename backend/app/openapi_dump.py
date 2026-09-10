"""Print the OpenAPI schema to stdout.

Used by `make types` to regenerate the frontend's TypeScript definitions.
Reads the schema straight from the application rather than over HTTP, so no
server needs to be running.
"""

import json

from app.config import Settings
from app.main import create_app


def main() -> None:
    # A throwaway configuration: generating the schema must not depend on a
    # .env being present, and must never touch a real database.
    settings = Settings(
        env="dev",
        database_url="sqlite://",
        app_password_hash="",
        jwt_secret="x" * 48,
    )
    print(json.dumps(create_app(settings).openapi(), indent=2))


if __name__ == "__main__":
    main()
