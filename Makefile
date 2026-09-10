.DEFAULT_GOAL := help
.PHONY: help setup api web preview tunnel seed types test test-pg test-web lint fmt migrate revision password build

help: ## Show this list
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

setup: ## Install every dependency (backend and frontend)
	cd backend && uv sync
	cd frontend && npm install

api: ## Run the backend on http://localhost:8000
	cd backend && uv run uvicorn app.main:app --reload --port 8000

web: ## Run the frontend on http://localhost:5173 (needs `make api` in another terminal)
	cd frontend && npm run dev

build: ## Compile the PWA into backend/app/static
	cd frontend && npm run build

preview: build ## Serve exactly like production: one origin, on http://localhost:8000
	cd backend && uv run uvicorn app.main:app --port 8000

tunnel: ## Public HTTPS URL so the phone can install the PWA (brew install cloudflared)
	@command -v cloudflared >/dev/null || { echo "Missing: brew install cloudflared"; exit 1; }
	@echo "Run 'make preview' in another terminal first."
	cloudflared tunnel --url http://localhost:8000

seed: ## Fill the development database with a realistic sample trip
	cd backend && uv run python -m app.seed

types: ## Regenerate the frontend's types from the backend's OpenAPI schema
	cd backend && uv run python -m app.openapi_dump > /tmp/openapi.json
	cd frontend && npx --yes openapi-typescript@7 /tmp/openapi.json -o src/api/schema.d.ts

test: ## Run the backend test suite (SQLite)
	cd backend && uv run pytest

test-pg: ## Same suite on real Postgres:  make test-pg TEST_DATABASE_URL=postgresql+psycopg://...
	@test -n "$(TEST_DATABASE_URL)" || \
		{ echo "Usage: make test-pg TEST_DATABASE_URL=postgresql+psycopg://user:pw@host/db"; exit 1; }
	cd backend && TEST_DATABASE_URL="$(TEST_DATABASE_URL)" uv run pytest

lint: ## Check style and formatting
	cd backend && uv run ruff check . && uv run ruff format --check .

fmt: ## Fix style and formatting
	cd backend && uv run ruff check --fix . && uv run ruff format .

migrate: ## Apply migrations to the database
	cd backend && uv run alembic upgrade head

revision: ## Create a migration:  make revision m="add expenses table"
	cd backend && uv run alembic revision --autogenerate -m "$(m)"

password: ## Generate APP_PASSWORD_HASH and JWT_SECRET for .env
	cd backend && uv run python -m app.hashpw
