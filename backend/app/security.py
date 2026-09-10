"""Passwords and session tokens.

Single user: there is no users table. There is one password, whose Argon2id
hash lives in `APP_PASSWORD_HASH`. Logging in returns a signed token carried in
an httpOnly cookie.
"""

import datetime as dt
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

SESSION_COOKIE = "session"
_ALGORITHM = "HS256"

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    """Constant-time check; any problem is a failure, never an error.

    A malformed hash in the configuration must not surface as a 500 that leaks
    internal state: it behaves exactly like a wrong password.
    """
    if not stored_hash:
        return False
    try:
        _hasher.verify(stored_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return True


def create_session_token(secret: str, days: int) -> str:
    now = dt.datetime.now(dt.UTC)
    payload = {
        "sub": "owner",
        "iat": now,
        "exp": now + dt.timedelta(days=days),
    }
    return jwt.encode(payload, secret, algorithm=_ALGORITHM)


def decode_session_token(token: str, secret: str) -> dict[str, Any] | None:
    """Return the payload, or None if the token is missing, expired or forged."""
    if not token or not secret:
        return None
    try:
        return jwt.decode(token, secret, algorithms=[_ALGORITHM])
    except jwt.PyJWTError:
        return None
