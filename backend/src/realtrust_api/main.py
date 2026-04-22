"""realtrust ai API — FastAPI app. Schema is created by backend/scripts/; this app only talks to DB."""
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from realtrust_api.config import settings
from realtrust_api.api.v1.router import api_router


async def correlation_id_middleware(request: Request, call_next):
    """Set X-Correlation-Id on request.state for traceability (02 §13.2). Use header if provided, else generate."""
    correlation_id = request.headers.get("X-Correlation-Id", "").strip() or str(uuid.uuid4())
    request.state.correlation_id = correlation_id
    response = await call_next(request)
    response.headers["X-Correlation-Id"] = correlation_id
    return response

# Import domain models so SQLAlchemy knows all tables (DB is created by scripts, we do not create_all)
from realtrust_api.domain.transactions import models as _tx  # noqa: F401
from realtrust_api.domain.properties import models as _prop  # noqa: F401
from realtrust_api.domain.documents import models as _doc  # noqa: F401
from realtrust_api.domain.inspections import models as _insp  # noqa: F401
from realtrust_api.domain.events import models as _ev  # noqa: F401
from realtrust_api.domain.matching import models as _match  # noqa: F401
from realtrust_api.domain.messaging import models as _msg  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown (e.g. health checks, pool warmup, MinIO bucket)."""
    from realtrust_api.core.storage import ensure_bucket_exists
    ensure_bucket_exists()
    yield
    # Shutdown: close pools if needed


app = FastAPI(
    title="realtrust ai API",
    description="Backend API for realtrust ai — PostgreSQL system of record, transaction state machine, RLS.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(correlation_id_middleware)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/health")
async def health():
    """Liveness/readiness (no DB check here; add if needed)."""
    return {"status": "ok"}
