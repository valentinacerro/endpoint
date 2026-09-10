# One image: FastAPI serves both the API and the compiled PWA.
#
# Docker is used instead of Render's Python runtime because the build needs
# both Node (to compile the frontend) and Python, and Render's Python image
# does not guarantee Node is present. This way the build is identical locally
# and in production.

# --- 1. Compile the PWA ---
FROM node:22-alpine AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# vite.config.ts writes to ../backend/app/static, i.e. /app/backend/app/static
RUN npm run build

# --- 2. Backend ---
FROM python:3.13-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Dependencies before the source: when only the code changes this layer stays
# cached and redeploys are much faster.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ ./
COPY --from=web /app/backend/app/static ./app/static

ENV PATH="/app/.venv/bin:$PATH"

# Unprivileged user.
RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

EXPOSE 8000
# Migrations run on every start: against an up-to-date database that is a
# single query, and it guarantees the deploy can never lag behind the schema.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
