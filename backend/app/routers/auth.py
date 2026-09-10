"""Login, logout and session state.

`public_router` is deliberately NOT covered by the session dependency — if it
were, logging in would be impossible. It is the only exception alongside
/health, and the parametrized test in `tests/test_auth.py` enforces that.
"""

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, Field

from app.deps import AppSettings, CurrentSession
from app.errors import AppError
from app.limiter import limiter
from app.security import SESSION_COOKIE, create_session_token, verify_password

public_router = APIRouter(prefix="/api/auth", tags=["auth"])
private_router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class SessionOut(BaseModel):
    authenticated: bool


def _set_session_cookie(response: Response, token: str, *, days: int, secure: bool) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=days * 24 * 60 * 60,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )


@public_router.post("/login", response_model=SessionOut)
@limiter.limit("10/minute")
def login(
    request: Request,  # required by slowapi to identify the caller
    payload: LoginIn,
    response: Response,
    settings: AppSettings,
) -> SessionOut:
    if not verify_password(payload.password, settings.app_password_hash):
        raise AppError(
            "invalid_password",
            "Wrong password",
            status_code=status.HTTP_401_UNAUTHORIZED,
            field="password",
        )
    token = create_session_token(settings.jwt_secret, settings.session_days)
    _set_session_cookie(response, token, days=settings.session_days, secure=settings.is_prod)
    return SessionOut(authenticated=True)


@public_router.post("/logout", response_model=SessionOut)
def logout(response: Response) -> SessionOut:
    response.delete_cookie(SESSION_COOKIE, path="/")
    return SessionOut(authenticated=False)


@private_router.get("/me", response_model=SessionOut)
def me(_: CurrentSession, response: Response, settings: AppSettings) -> SessionOut:
    """Confirm the session and extend it.

    The PWA calls this on every launch, which makes the expiry effectively
    sliding: as long as the app is opened within 30 days, no new login.
    """
    token = create_session_token(settings.jwt_secret, settings.session_days)
    _set_session_cookie(response, token, days=settings.session_days, secure=settings.is_prod)
    return SessionOut(authenticated=True)
