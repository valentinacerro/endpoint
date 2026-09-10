.DEFAULT_GOAL := help
.PHONY: help setup api web build test lint fmt migrate revision password

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

test: ## Run the backend test suite
	cd backend && uv run pytest

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
