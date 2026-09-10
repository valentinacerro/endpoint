"""Exchange rates, from the European Central Bank via Frankfurter.

Free, no key, no account. What it gives you is the ECB *reference* rate,
which is not what a card charges — banks add a spread of a percent or two.
So a rate fetched here is a good estimate and is recorded as such, and can
be replaced later with the real figure off a statement.
"""

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal

import httpx

from app.enums import RateSource
from app.errors import AppError

_BASE = "https://api.frankfurter.dev/v1"
_TIMEOUT_SECONDS = 8.0


@dataclass(frozen=True)
class Rate:
    rate: Decimal
    #: The day the rate is actually from, which is not always the day asked
    #: for: the ECB publishes on working days, so a Saturday purchase is
    #: converted at Friday's rate and should say so.
    date: dt.date
    source: RateSource


async def fetch(base: str, quote: str, on: dt.date) -> Rate:
    base, quote = base.upper(), quote.upper()
    if base == quote:
        return Rate(rate=Decimal(1), date=on, source=RateSource.ECB)

    url = f"{_BASE}/{on.isoformat()}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get(url, params={"base": base, "symbols": quote})
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise AppError(
            "rate_unavailable",
            "Could not fetch an exchange rate",
            status_code=503,
        ) from exc

    value = (payload.get("rates") or {}).get(quote)
    if value is None:
        raise AppError(
            "rate_unavailable",
            f"No rate published for {base} to {quote}",
            status_code=503,
        )

    return Rate(
        # Through str, not float: binary floating point has no business
        # anywhere near money.
        rate=Decimal(str(value)),
        date=dt.date.fromisoformat(payload.get("date", on.isoformat())),
        source=RateSource.ECB,
    )
