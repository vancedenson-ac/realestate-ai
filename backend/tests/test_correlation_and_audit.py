"""Correlation ID (02 §13.2) and audit event coverage (AUDIT §8.1) tests."""

import os
from urllib.parse import urlparse

import pytest
from httpx import AsyncClient

from realtrust_api.config import settings

TX_PRE_LISTING = "c0000001-0000-0000-0000-000000000002"
USER_ALICE = "b0000001-0000-0000-0000-000000000001"
ORG_ACME = "a0000001-0000-0000-0000-000000000001"


@pytest.mark.asyncio
async def test_response_includes_correlation_id(client: AsyncClient, api_base: str) -> None:
    """X-Correlation-Id is set on every response (from header or generated)."""
    r = await client.get(f"{api_base}/health")
    # Health is outside API prefix; use a v1 endpoint
    r2 = await client.get(f"{api_base}/transactions", headers={"Accept": "application/json"})
    assert r2.status_code == 200
    assert "X-Correlation-Id" in r2.headers
    assert r2.headers["X-Correlation-Id"].strip() != ""


@pytest.mark.asyncio
async def test_correlation_id_echoed_when_sent(client: AsyncClient, api_base: str) -> None:
    """When client sends X-Correlation-Id, response echoes it."""
    custom_id = "my-corr-request-123"
    r = await client.get(
        f"{api_base}/transactions",
        headers={"Accept": "application/json", "X-Correlation-Id": custom_id},
    )
    assert r.status_code == 200
    assert r.headers.get("X-Correlation-Id") == custom_id


@pytest.mark.asyncio
async def test_regulated_action_writes_audit_with_correlation_id(
    client: AsyncClient, api_base: str
) -> None:
    """After a regulated action (escrow assign), audit_events has a row with correlation_id."""
    # Use DUE_DILIGENCE tx 005 (Alice can see it as SELLER_AGENT); assign escrow (writes audit + domain_event).
    tx_id = "c0000001-0000-0000-0000-000000000005"
    escrow_officer_id = "b0000001-0000-0000-0000-000000000002"  # Bob from seed
    correlation_value = "test-audit-correlation-456"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-User-Id": USER_ALICE,
        "X-Role": "SELLER_AGENT",
        "X-Organization-Id": ORG_ACME,
        "X-Correlation-Id": correlation_value,
    }
    r = await client.post(
        f"{api_base}/transactions/{tx_id}/escrow/assignments",
        headers=headers,
        json={"escrow_officer_id": escrow_officer_id},
    )
    assert r.status_code == 201, (r.status_code, r.text)
    assert r.headers.get("X-Correlation-Id") == correlation_value

    # Verify audit_events has a row with this correlation_id (query with Alice context for RLS)
    url = urlparse(settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://"))
    try:
        import psycopg2
    except ImportError:
        pytest.skip("psycopg2 not installed; cannot verify audit_events")
    conn = psycopg2.connect(
        host=url.hostname or "localhost",
        port=url.port or 5432,
        user=os.environ.get("REALTRUST_DB_ADMIN_USER") or url.username or "realtrust",
        password=os.environ.get("REALTRUST_DB_ADMIN_PASSWORD") or url.password or "realtrust",
        dbname=(url.path or "/realtrust").lstrip("/") or "realtrust",
    )
    try:
        conn.set_session(autocommit=False)
        with conn.cursor() as cur:
            cur.execute("SET LOCAL app.user_id = %s", (USER_ALICE,))
            cur.execute("SET LOCAL app.organization_id = %s", (ORG_ACME,))
            cur.execute("SET LOCAL app.role = %s", ("SELLER_AGENT",))
            cur.execute(
                """
                SELECT event_id, event_type, action, outcome, correlation_id
                FROM audit_events
                WHERE actor_id = %s::uuid AND correlation_id = %s
                ORDER BY occurred_at DESC
                LIMIT 1
                """,
                (USER_ALICE, correlation_value),
            )
            row = cur.fetchone()
        assert row is not None, "audit_events should have row with correlation_id"
        _event_id, event_type, action, outcome, correlation_id = row
        assert event_type == "ESCROW_OFFICER_ASSIGNED"
        assert action == "assign_escrow_officer"
        assert outcome == "success"
        assert correlation_id == correlation_value
    finally:
        conn.close()
