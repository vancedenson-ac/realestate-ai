# realtrust ai — Backend (Local Development)

Local development setup: PostgreSQL 16 (with pgvector, PostGIS), MinIO, init scripts, and seed data.

## Prerequisites

- Docker and Docker Compose
- Windows (scripts use `.bat`; equivalent shell commands work on Linux/macOS)

## Quick start

1. **Start services** (Postgres + MinIO):
   ```bat
   docker compose up -d
   ```

2. **Initialize database** (extensions + schema; run once, or after reset). From repo root:
   ```bat
   scripts\init-db.bat
   ```
   This waits for Postgres, then applies roles and schema from `backend/scripts/`.

3. **Seed mock data** (state machine + users, orgs, transactions, properties). From repo root:
   ```bat
   scripts\seed.bat
   ```

## Services

| Service | Port | Purpose |
|---------|------|---------|
| `db` | 5432 | PostgreSQL 16 + PostGIS + pgvector |
| `minio` | 9000 (API), 9001 (console) | S3-compatible object storage |

- **DB**: `realtrust` / `realtrust` / `realtrust`
- **MinIO**: `minioadmin` / `minioadmin` (console: http://localhost:9001). To avoid the default-credentials warning, set `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` in a `.env` in this directory.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/init-extensions.sql` | Run automatically on first DB start (uuid-ossp, pgcrypto, vector, postgis) |
| `scripts/02-schema.sql` | All tables (identity, state machine, events, documents, properties, messaging, etc.) |
| `scripts/03-seed.sql` | State machine seeds + mock users, orgs, transactions, properties, listings |
| `scripts/init-db.bat` | Start db/minio and apply schema |
| `seed.bat` | Load seed data (requires schema already applied) |

## Resetting the database

```bat
docker compose down -v
docker compose up -d db minio
scripts\init-db.bat
seed.bat
```

## API testing

Integration tests hit the real API and DB. **Requires DB up** (`docker compose up -d db`).

1. Start DB:
   ```bat
   docker compose up -d db
   ```

2. Run tests (from `backend/` directory):
   ```bat
   pip install -e ".[dev]"
   pytest
   ```
   Or with uv: `uv run pytest`

   Pytest runs **schema + seed** before tests (via `docker compose exec -T db psql ...`), so all tests run with no skips when the DB container is up. Run from repo root: `scripts\init-db.bat` then `scripts\seed.bat` if you need to reset the DB first. If docker/seed is unavailable, 4 transaction tests skip.

Tests cover:
- **Health**: `GET /health`
- **Transactions**: list, get, create, transition (404, illegal transition)
- **Properties**: list, get, create, update (404, validation)
- **Listings**: list, get, create, update (404, validation)

## Schema and spec

Schema and seeds follow the realtrust-ai spec (transaction state machine, RLS-ready structure, domain events, outbox). See `.cursor/skills/realtrust-backend/references/` for full specification.
