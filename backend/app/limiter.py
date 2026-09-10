"""Shared rate limiter.

Kept in its own module to avoid a circular import between `main` and the
routers that use the `@limiter.limit(...)` decorator.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
