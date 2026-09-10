"""Health probe — public and deliberately dumb.

Used by the warm-up ping the PWA fires at startup and by the cron job that
keeps the service awake. It **must not touch the database**: querying it would
keep Neon awake too, burning its free compute hours.
"""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
