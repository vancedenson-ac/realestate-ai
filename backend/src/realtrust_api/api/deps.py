"""Shared API dependencies: DB session, auth placeholder (RLS context set here when auth is added)."""
from collections.abc import AsyncGenerator
import os
from uuid import UUID

from fastapi import Depends, Header, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from realtrust_api.db.session import async_session_factory, engine, get_db  # noqa: F401


def get_correlation_id(request: Request) -> str:
    """Return request correlation ID (set by middleware from X-Correlation-Id or generated). 02 §13.2."""
    return getattr(request.state, "correlation_id", "") or ""

# 06-authorization-and-data-access: Session context MUST be derived from validated identity,
# NOT caller-controlled. Production MUST use OIDC/OAuth2 token claims for app.user_id,
# app.organization_id, app.role, app.license_state. Headers below are DEV STUB ONLY.


async def get_current_user_id(
    x_user_id: UUID | None = Header(None, alias="X-User-Id"),
) -> UUID:
    """Stub: resolve current user. Use X-User-Id header or default seed user (Bob Buyer).
    Production: MUST resolve from verified JWT/OIDC token; MUST NOT trust X-User-Id in production.
    """
    if x_user_id is not None:
        return x_user_id
    return UUID("b0000001-0000-0000-0000-000000000002")  # Bob Buyer from seed


def _default_org_id() -> str:
    return "a0000001-0000-0000-0000-000000000001"


def _default_role() -> str:
    return "BUYER"


def _get_rls_context_from_request(request: Request, user_id: UUID) -> tuple[str, str, str, str]:
    """Derive RLS session context. DEV: from headers. PROD: MUST come from validated token only."""
    if os.environ.get("REALTRUST_AUTH_STRICT") == "1":
        # Production mode: do not trust caller-supplied org/role/state; use token or fail
        org_id = request.state.organization_id if hasattr(request.state, "organization_id") else None
        role = request.state.role if hasattr(request.state, "role") else None
        license_state = request.state.license_state if hasattr(request.state, "license_state") else ""
        risk_clearance = getattr(request.state, "risk_clearance", None) or ""
        if org_id is None or role is None:
            raise RuntimeError(
                "REALTRUST_AUTH_STRICT: app.organization_id and app.role must be set from validated identity"
            )
        return str(org_id), role, license_state, risk_clearance
    # Dev stub: headers (MUST NOT be used when REALTRUST_AUTH_STRICT=1)
    org_id = request.headers.get("X-Organization-Id") or _default_org_id()
    role = request.headers.get("X-Role") or _default_role()
    license_state = request.headers.get("X-License-State") or ""
    risk_clearance = request.headers.get("X-Risk-Clearance") or ""
    return org_id, role, license_state, risk_clearance


async def get_db_with_rls(
    request: Request,
    user_id: UUID = Depends(get_current_user_id),
) -> AsyncGenerator[AsyncSession, None]:
    """
    DB session with PostgreSQL RLS context set (06-authorization-and-data-access).
    Sets app.user_id, app.organization_id, app.role, app.license_state (SET LOCAL).
    Production: values MUST be derived from validated identity (token), not headers.
    """
    org_id, role, license_state, risk_clearance = _get_rls_context_from_request(request, user_id)

    def _quote(s: str) -> str:
        return s.replace("'", "''")

    # IMPORTANT: bind a single connection per request so SET LOCAL applies to ORM flushes.
    async with engine.connect() as conn:
        async with AsyncSession(bind=conn, expire_on_commit=False, autoflush=False) as session:
            async with session.begin():
                await session.execute(text(f"SET LOCAL app.user_id = '{_quote(str(user_id))}'"))
                await session.execute(text(f"SET LOCAL app.organization_id = '{_quote(org_id)}'"))
                await session.execute(text(f"SET LOCAL app.role = '{_quote(role)}'"))
                await session.execute(text(f"SET LOCAL app.license_state = '{_quote(license_state)}'"))
                if risk_clearance:
                    await session.execute(text(f"SET LOCAL app.risk_clearance = '{_quote(risk_clearance)}'"))
                # Fail-fast if RLS context didn't stick (prevents silent RLS denials).
                chk = await session.execute(
                    text(
                        "SELECT "
                        "current_setting('app.user_id', true) AS uid, "
                        "current_setting('app.organization_id', true) AS org, "
                        "current_setting('app.role', true) AS role"
                    )
                )
                row = chk.mappings().one()
                if not row.get("uid") or not row.get("org") or not row.get("role"):
                    raise RuntimeError(f"RLS context missing/empty: {dict(row)}")
                yield session
