# RealTrust AI — Technical Overview

DEMO SITE: https://realtrust-mock-v2.vercel.app/listings

# RealTrust AI

Real estate transaction platform — PostgreSQL as system of record, FastAPI backend, Next.js frontend. Transaction state machine and RLS define legality and access; events are evidence; AI is advisory only.

---

## Quickstart (local) — run from repo root

**Prerequisites:** Docker & Docker Compose v2. To run tests on the host you also need either **uv** or **Python 3.12+** (and Node 20+ for frontend tests).

**Minimal steps (copy-paste from repo root):**
```bash
docker compose up -d
scripts\init-db.bat
scripts\seed.bat
cd frontend && npm install && cd ..
scripts\test.bat
```
(Unix: use `./scripts/init-db.sh`, `./scripts/seed.sh`, and run `cd backend && uv run pytest` then `cd frontend && npm run test`.)

### 1. Start services

From repo root:

```bash
docker compose up -d
```

- **db** (PostgreSQL 16 + PostGIS + pgvector) — port 5432  
- **minio** — 9000 (API), 9001 (Console)  
- **minio-cors** — one-off: creates bucket `realtrust` and applies CORS (so browser uploads work)  
- **api** (FastAPI) — 8000  
- **frontend** (Next.js) — 3000  

### 2. Init and seed database (required before backend tests)

From repo root. **Do this after `docker compose up -d`** so the DB is up and schema/seed are applied.

```bash
# Windows
scripts\init-db.bat
scripts\seed.bat

# Unix
./scripts/init-db.sh
./scripts/seed.sh
```

- **init-db:** waits for Postgres, then runs `01-roles.sql`, `02-schema.sql`.  
- **seed:** runs `01-roles.sql`, `02-schema.sql`, `03-seed.sql` (users, orgs, transactions, listings, etc.).

**Manual alternative:**

```bash
docker compose exec db psql -U realtrust -d realtrust -f /scripts/01-roles.sql
docker compose exec db psql -U realtrust -d realtrust -f /scripts/02-schema.sql
docker compose exec db psql -U realtrust -d realtrust -f /scripts/03-seed.sql
```

### 3. Run all tests

From repo root. Backend tests need the DB up and seeded (step 2). Frontend tests need `npm install` once in `frontend/`.

**One command (Windows, from repo root):**

```bash
scripts\test.bat
```

This runs backend tests (using **uv** if available, otherwise a temp Python venv) then frontend tests (`npm run test`). You need **uv** or **Python 3.12+** for backend; **Node 20+** and `npm install` in `frontend/` for frontend (the script runs `npm run test`, which uses `npx jest`).

**Manual (any OS):**

```bash
# Backend (from repo root; DB must be up + seeded)
cd backend
uv run pytest
# or: python -m venv .venv_temp && .venv_temp\Scripts\pip install -e ".[dev]" && .venv_temp\Scripts\pytest

# Frontend (from repo root)
cd frontend
npm install
npm run test
```

Backend config uses `DATABASE_URL=postgresql+asyncpg://app_user:realtrust@localhost:5432/realtrust` by default, so tests connect to the DB exposed on the host.

### 4. MinIO (if not using compose or bucket missing)

If you run MinIO separately or the `realtrust` bucket was not created:

1. Open **MinIO Console**: http://localhost:9001  
2. Login: **minioadmin** / **minioadmin** (or set `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` in `.env`)  
3. Create bucket: **realtrust**  
4. Set CORS on bucket: use `scripts/minio-cors.xml` (Allow PUT/GET from `http://localhost:3000`, `http://127.0.0.1:3000`)  

With `docker compose up -d`, the **minio-cors** service creates the bucket and CORS automatically.

### 5. URLs

| What        | URL |
|------------|-----|
| Frontend   | http://localhost:3000 |
| API        | http://localhost:8000/realtrust-ai/v1 |
| API docs   | http://localhost:8000/docs |
| MinIO API  | http://localhost:9000 |
| MinIO Console | http://localhost:9001 |

### 6. Map view (Mapbox token)

The Listings page includes an interactive map view (Mapbox GL JS). To enable it:

1. Create a free account at https://account.mapbox.com/
2. Copy your default public token (starts with `pk.`)
3. Add to `frontend/.env.local`:
   ```
   NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...your_token...
   ```
4. Restart the frontend dev server

If the token is not set, the listings page shows a helpful message and falls back to grid view.

---

## Running without Docker

- **Backend:** From repo root, `cd backend`, create venv or `uv sync`, set `DATABASE_URL` (and optional S3/MinIO env). Apply `backend/scripts/01-roles.sql`, `02-schema.sql`, `03-seed.sql` to Postgres (e.g. with Docker DB: `scripts\init-db.bat` and `scripts\seed.bat`). Then `uv run uvicorn realtrust_api.main:app --reload`.  
- **Frontend:** From repo root, `cd frontend`, `npm install`, set `NEXT_PUBLIC_API_BASE=http://localhost:8000` in `.env.local`, `npm run dev`. **For the map view:** also set `NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...` in `.env.local` (get a free public token at https://account.mapbox.com/access-tokens/). The listings page falls back to grid view when the token is absent.  
- **MinIO:** Run MinIO locally or use a remote S3 endpoint; create bucket `realtrust` and CORS as above. Backend config: `S3_ENDPOINT_URL`, `S3_PUBLIC_ENDPOINT_URL`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_USE_SSL=false` for local.

---

## Repo layout

| Path | Purpose |
|------|--------|
| `backend/` | FastAPI app (`src/realtrust_api/`), domain models, API v1; `backend/scripts/` has 01-roles, 02-schema, 03-seed |
| `frontend/` | Next.js app (production frontend) |
| `docs/` | Completion plans, audits, user-flow docs |
| `scripts/` | Root init/seed/test scripts (init-db, seed, test.bat), MinIO CORS XML |
| `docker-compose.yml` | Full stack (db, api, minio, minio-cors, frontend) |

---

**Done (context):** User flow (buyer offer, Escrow, Title, Inspections, Offers, Make offer); UI Phase A & B (checklist, escrow/title forms, quick actions, pipeline filter, open house, version history, escrow picker); list loading (cursor-based Load more, dashboard limits). Phase 2 (REGULATED tables, access logging, correlation ID, PRECONDITION_FAILED UX, document checklist) — **Done**.




Security-first, specification-driven architecture of RealTrust AI. All normative requirements are traceable to the canonical spec set in `.cursor/skills/realtrust-backend/references/` and `.cursor/skills/realtrust-frontend/references/`.*

---


1. **Single source of truth for legality** — One state machine spec drives DB seeds, transition function, and negative tests. No handwritten drift; illegal transitions are rejected at the database.
2. **Authorization at the data layer** — RLS and explicit denies make “prove the lender could not see inspections” a matter of policy and evidence, not API discipline.
3. **Evidence-first events** — No event without commit; outbox for publishing; payloads that don’t bypass RLS. Audit and replay are built into the design.
4. **Journey = law + milestone facts** — Every UI step that matters for compliance exists as an authoritative fact in PostgreSQL and, where required, as a DB precondition. CLOSED means deed + ownership transfer, not “button clicked.”
5. **AI is advisory only** — No AI writes to authoritative tables or bypasses access control; provenance and governance are specified (02 §9, 10-ai-boundaries).
6. **Proof-oriented testing** — Invariant and negative tests (illegal transitions, wrong role, explicit denies) demonstrate that the system cannot enter disallowed states or grant disallowed access.



All of the above are in `.cursor/skills/realtrust-backend/references/` and `.cursor/skills/realtrust-frontend/references/`. The implementation in `backend/realtrust-ai/` and `frontend_v2/` is aligned with these specifications to deliver a **security-first, audit-ready, regulator-friendly** real estate transaction platform.
