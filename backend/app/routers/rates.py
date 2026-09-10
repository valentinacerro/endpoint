import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from app.enums import RateSource
from app.limiter import limiter
from app.services import rates

router = APIRouter(prefix="/api/rates", tags=["rates"])


class RateOut(BaseModel):
    rate: float
    date: dt.date
    source: RateSource


@router.get("", response_model=RateOut)
@limiter.limit("60/minute")
async def get_rate(
    request: Request,
    base: Annotated[str, Query(min_length=3, max_length=3)],
    quote: Annotated[str, Query(min_length=3, max_length=3)],
    on: Annotated[dt.date, Query()],
) -> rates.Rate:
    return await rates.fetch(base, quote, on)
