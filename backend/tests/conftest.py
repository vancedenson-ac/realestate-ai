"""Pytest fixtures for realtrust API tests. Requires DB up (docker compose up -d db). Schema + seed run before tests."""
import asyncio
import os
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import pytest
from httpx import ASGITransport, AsyncClient

from realtrust_api.main import app
from realtrust_api.config import settings


def _run_seed_via_docker(scripts_dir: Path, schema_path: Path, seed_path: Path, cwd: Path) -> None:
    """Pipe roles + schema + seed into docker compose exec db psql. Requires docker + db up."""
    cmd = ["docker", "compose", "exec", "-T", "db", "psql", "-U", "realtrust", "-d", "realtrust"]
    roles_path = scripts_dir / "01-roles.sql"
    paths = (roles_path, schema_path, seed_path) if roles_path.exists() else (schema_path, seed_path)
    for path in paths:
        with open(path, encoding="utf-8") as f:
            r = subprocess.run(cmd, stdin=f, cwd=cwd, capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            raise RuntimeError(f"Seed failed: {path.name}\n{r.stderr or r.stdout}")


def _run_psql_direct(schema_path: Path, seed_path: Path) -> None:
    """Apply roles + schema + seed via local psql (fallback when Docker exec not available)."""
    # DATABASE_URL is postgresql+asyncpg://user:pass@host:port/dbname
    url = urlparse(settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://"))
    host = url.hostname or "localhost"
    port = url.port or 5432
    # IMPORTANT: schema/seed must be applied as admin role (needs CREATE/ALTER/GRANT).
    # Runtime/app connections use app_user to enforce RLS; migrations/seeds use realtrust.
    user = os.environ.get("REALTRUST_DB_ADMIN_USER") or "realtrust"
    dbname = (url.path or "/realtrust").lstrip("/") or "realtrust"
    password = os.environ.get("REALTRUST_DB_ADMIN_PASSWORD") or "realtrust"
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    roles_path = schema_path.parent / "01-roles.sql"
    paths = (roles_path, schema_path, seed_path) if roles_path.exists() else (schema_path, seed_path)
    for path in paths:
        cmd = ["psql", "-h", host, "-p", str(port), "-U", user, "-d", dbname, "-f", str(path)]
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError(f"Seed failed: {path.name}\n{r.stderr or r.stdout}")


def _run_schema_via_psycopg2(schema_path: Path, seed_path: Path) -> None:
    """Apply schema + seed via psycopg2 (fallback when Docker and psql not available).
    Skips 01-roles.sql so existing app_user/grants are not dropped (roles are for fresh DB only).
    """
    import psycopg2
    url = urlparse(settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://"))
    host = url.hostname or "localhost"
    port = url.port or 5432
    user = os.environ.get("REALTRUST_DB_ADMIN_USER") or "realtrust"
    dbname = (url.path or "/realtrust").lstrip("/") or "realtrust"
    password = os.environ.get("REALTRUST_DB_ADMIN_PASSWORD") or "realtrust"
    conn = psycopg2.connect(host=host, port=port, user=user, password=password, dbname=dbname)
    try:
        for path in (schema_path, seed_path):
            with open(path, encoding="utf-8") as f:
                sql = f.read()
            with conn.cursor() as cur:
                cur.execute(sql)
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise RuntimeError(f"Schema/seed failed: {e}") from e
    finally:
        conn.close()


@pytest.fixture(scope="session", autouse=True)
def ensure_schema_and_seed():
    """Run 02-schema.sql and 03-seed.sql before any test so DB has data (no skips). Uses docker compose exec, then psql fallback."""
    root = Path(__file__).resolve().parent.parent
    scripts_dir = root / "scripts"
    schema_path = scripts_dir / "02-schema.sql"
    seed_path = scripts_dir / "03-seed.sql"
    if not schema_path.exists() or not seed_path.exists():
        return
    applied = False
    try:
        _run_seed_via_docker(scripts_dir, schema_path, seed_path, root)
        applied = True
    except (FileNotFoundError, RuntimeError, subprocess.TimeoutExpired):
        try:
            _run_psql_direct(schema_path, seed_path)
            applied = True
        except (FileNotFoundError, RuntimeError, subprocess.TimeoutExpired):
            try:
                _run_schema_via_psycopg2(schema_path, seed_path)
                applied = True
            except (ImportError, RuntimeError):
                pass
    if not applied:
        import warnings
        warnings.warn(
            "Schema/seed not applied (Docker, psql, and psycopg2 unavailable or failed). "
            "Re-run: from repo root run scripts\\seed.bat (Docker) or install psycopg2-binary and run pytest again.",
            UserWarning,
            stacklevel=0,
        )


@pytest.fixture(scope="session")
def event_loop():
    """Session-scoped event loop so SQLAlchemy async engine/connections stay on same loop."""
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def api_base() -> str:
    """Base path for v1 API (e.g. /realtrust-ai/v1)."""
    return settings.API_V1_PREFIX


@pytest.fixture
async def client(api_base: str) -> AsyncClient:
    """Async HTTP client for the FastAPI app. Uses ASGI transport."""
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Accept": "application/json"},
    ) as ac:
        yield ac


@pytest.fixture
def api_client(client: AsyncClient, api_base: str):
    """Client + api_base for building URLs: (client, api_base)."""
    return client, api_base


@pytest.fixture
async def client_as_bob(api_base: str) -> AsyncClient:
    """Async HTTP client as Bob Buyer (RLS: BUYER role; must not see PRE_LISTING)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={
            "Accept": "application/json",
            "X-User-Id": "b0000001-0000-0000-0000-000000000002",
            "X-Role": "BUYER",
            "X-Organization-Id": "a0000001-0000-0000-0000-000000000001",
        },
    ) as ac:
        yield ac


@pytest.fixture
async def client_as_alice(api_base: str) -> AsyncClient:
    """Async HTTP client with X-User-Id: Alice Agent (for chat/transaction tests)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={
            "Accept": "application/json",
            "X-User-Id": "b0000001-0000-0000-0000-000000000001",
            "X-Role": "SELLER_AGENT",
            "X-Organization-Id": "a0000001-0000-0000-0000-000000000001",
        },
    ) as ac:
        yield ac


@pytest.fixture
async def client_as_eve(api_base: str) -> AsyncClient:
    """Async HTTP client as Eve Lender (RLS: LENDER; must not see inspection_report docs)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={
            "Accept": "application/json",
            "X-User-Id": "b0000001-0000-0000-0000-000000000005",
            "X-Role": "LENDER",
            "X-Organization-Id": "a0000001-0000-0000-0000-000000000001",
        },
    ) as ac:
        yield ac


@pytest.fixture
async def client_as_dave(api_base: str) -> AsyncClient:
    """Async HTTP client as Dave Escrow (org First Escrow Co a0000002). Not listing agent/broker for Acme listings."""
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={
            "Accept": "application/json",
            "X-User-Id": "b0000001-0000-0000-0000-000000000004",
            "X-Role": "ESCROW_OFFICER",
            "X-Organization-Id": "a0000001-0000-0000-0000-000000000002",
        },
    ) as ac:
        yield ac


@pytest.fixture
async def client_as_bailey(api_base: str) -> AsyncClient:
    """Async HTTP client as Bailey (BUYER_AGENT). For milestone gating test (DUE_DILIGENCE → FINANCING)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-User-Id": "b0000001-0000-0000-0000-000000000006",
            "X-Role": "BUYER_AGENT",
            "X-Organization-Id": "a0000001-0000-0000-0000-000000000001",
        },
    ) as ac:
        yield ac


def error_code(response_json: dict) -> str | None:
    """Extract error code from FastAPI error response (detail.error.code)."""
    return ((response_json.get("detail") or {}).get("error") or {}).get("code")
