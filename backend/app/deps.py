"""Dependencies shared by the routers."""

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_db
from app.security import SESSION_COOKIE, decode_session_token

DbSession = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]

_UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail={
        "error": {
            "code": "unauthenticated",
            "message": "Missing or expired session",
            "field": None,
        }
    },
)


def current_session(request: Request, settings: AppSettings) -> str:
    """Require a valid session cookie.

    Mounted on the whole `/api` router, so a route added tomorrow is protected
    by default: protection is removed by exception, never added by choice.
    """
    token = request.cookies.get(SESSION_COOKIE, "")
    payload = decode_session_token(token, settings.jwt_secret)
    if payload is None:
        raise _UNAUTHENTICATED
    return str(payload.get("sub", "owner"))


CurrentSession = Annotated[str, Depends(current_session)]
