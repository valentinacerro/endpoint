"""The FastAPI application.

It serves both the API and the compiled PWA, on purpose: a single origin means
first-party session cookies (Chrome keeps tightening the screws on third-party
ones) and no CORS configuration to get wrong.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Scope

from app.config import Settings, get_settings
from app.deps import current_session
from app.errors import register_error_handlers
from app.limiter import limiter
from app.routers import attachments, auth, bookings, bundle, health, places, stops, trips

STATIC_DIR = Path(__file__).parent / "static"


class SPAStaticFiles(StaticFiles):
    """Static files with an index.html fallback for client-side routes.

    The fallback is disabled under /api: a missing endpoint must answer 404 in
    JSON, not hand back the home page with status 200.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and not path.startswith("api"):
                return await super().get_response("index.html", scope)
            raise


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    hide_docs = settings.is_prod

    app = FastAPI(
        title="Travel organizer",
        version="0.1.0",
        # In production the interactive docs would enumerate the whole API on a
        # public URL, so they are switched off.
        docs_url=None if hide_docs else "/docs",
        redoc_url=None,
        openapi_url=None if hide_docs else "/openapi.json",
    )

    app.state.limiter = limiter
    app.state.settings = settings
    register_error_handlers(app)

    @app.exception_handler(RateLimitExceeded)
    async def _rate_limited(_: Request, exc: RateLimitExceeded) -> JSONResponse:
        return JSONResponse(
            status_code=429,
            content={
                "error": {
                    "code": "rate_limited",
                    "message": "Too many attempts, try again shortly",
                    "field": None,
                }
            },
        )

    if settings.is_prod:

        @app.middleware("http")
        async def _security_headers(request: Request, call_next):
            response = await call_next(request)
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Referrer-Policy"] = "no-referrer"
            return response

    # --- Public routes: these three and no others. ---
    app.include_router(health.router)
    app.include_router(auth.public_router)

    # --- Everything else is protected by default. ---
    # The dependency sits on the router rather than on individual routes, so an
    # endpoint added tomorrow is covered without anyone having to remember.
    api = APIRouter(dependencies=[Depends(current_session)])
    api.include_router(auth.private_router)
    api.include_router(trips.router)
    api.include_router(stops.router)
    api.include_router(bookings.router)
    api.include_router(places.router)
    api.include_router(attachments.router)
    api.include_router(bundle.router)
    app.include_router(api)

    # --- The compiled PWA (only exists after `npm run build`). ---
    if STATIC_DIR.is_dir():
        app.mount("/", SPAStaticFiles(directory=STATIC_DIR, html=True), name="pwa")

    return app


app = create_app()
