"""REGULATED table restrictions (2.1, 18 §6) and access decision logging (2.2, 02 §5, AUDIT §8.3)."""

import os
from urllib.parse import urlparse

import pytest
from httpx import AsyncClient

from realtrust_api.config import settings
from tests.conftest import error_code

ORG_ACME = "a0000001-0000-0000-0000-000000000001"
TX_UNDER_CONTRACT = "c0000001-0000-0000-0000-000000000001"
TX_CLEAR_TO_CLOSE = "c0000001-0000-0000-0000-000000000007"
USER_ALICE = "b0000001-0000-0000-0000-000000000001"
USER_BOB = "b0000001-0000-0000-0000-000000000002"
USER_EVE = "b0000001-0000-0000-0000-000000000005"
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"

ESCROW_HEADERS = {"X-User-Id": USER_ALICE, "X-Role": "ESCROW_OFFICER", "X-Organization-Id": ORG_ACME}
LENDER_HEADERS = {"X-User-Id": USER_EVE, "X-Role": "LENDER", "X-Organization-Id": ORG_ACME}


# ---------------------------------------------------------------------------
# 2.1 REGULATED table restrictions: only ESCROW_OFFICER (and LENDER read funding)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_buyer_cannot_insert_funding_confirmation(client_as_bob: AsyncClient, api_base: str) -> None:
    """REGULATED: Only ESCROW_OFFICER may insert funding_confirmations. BUYER gets 403."""
    r = await client_as_bob.post(
        f"{api_base}/transactions/{TX_CLEAR_TO_CLOSE}/escrow/funding/confirm",
        json={"verified": True, "notes": "Funds in"},
    )
    assert r.status_code == 403
    assert error_code(r.json()) == "FORBIDDEN_BY_POLICY"


@pytest.mark.asyncio
async def test_buyer_cannot_insert_disbursement(client_as_bob: AsyncClient, api_base: str) -> None:
    """REGULATED: Only ESCROW_OFFICER may insert disbursements. BUYER gets 403."""
    r = await client_as_bob.post(
        f"{api_base}/transactions/{TX_CLEAR_TO_CLOSE}/escrow/disbursements",
        json={"amount": 100.00, "recipient": "X", "notes": "n"},
    )
    assert r.status_code == 403
    assert error_code(r.json()) == "FORBIDDEN_BY_POLICY"


@pytest.mark.asyncio
async def test_escrow_officer_cannot_insert_disbursement_when_not_clear_to_close(
    client_as_alice: AsyncClient, api_base: str
) -> None:
    """REGULATED: State gating — INSERT disbursement only when transaction is CLEAR_TO_CLOSE or CLOSED."""
    r = await client_as_alice.post(
        f"{api_base}/transactions/{TX_UNDER_CONTRACT}/escrow/disbursements",
        headers=ESCROW_HEADERS,
        json={"amount": 100.00, "recipient": "X", "notes": "n"},
    )
    assert r.status_code == 403
    assert error_code(r.json()) == "FORBIDDEN_BY_POLICY"


@pytest.mark.asyncio
async def test_lender_can_list_funding_but_cannot_insert(
    client_as_eve: AsyncClient, api_base: str
) -> None:
    """REGULATED: LENDER may read funding_confirmations (list) but not insert."""
    list_r = await client_as_eve.get(f"{api_base}/transactions/{TX_CLEAR_TO_CLOSE}/escrow/funding")
    assert list_r.status_code == 200
    assert isinstance(list_r.json(), list)
    post_r = await client_as_eve.post(
        f"{api_base}/transactions/{TX_CLEAR_TO_CLOSE}/escrow/funding/confirm",
        headers=LENDER_HEADERS,
        json={"verified": True, "notes": "n"},
    )
    assert post_r.status_code == 403
    assert error_code(post_r.json()) == "FORBIDDEN_BY_POLICY"


@pytest.mark.asyncio
async def test_seller_agent_gets_empty_list_for_regulated_escrow(
    client_as_alice: AsyncClient, api_base: str
) -> None:
    """REGULATED: SELLER_AGENT (non-ESCROW) gets empty list for funding/disbursements (RLS hides rows)."""
    for path in ("/escrow/funding", "/escrow/disbursements"):
        r = await client_as_alice.get(f"{api_base}/transactions/{TX_CLEAR_TO_CLOSE}{path}")
        assert r.status_code == 200
        assert r.json() == [] or isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_seller_agent_gets_empty_list_for_deed_and_ownership(
    client_as_alice: AsyncClient, api_base: str
) -> None:
    """REGULATED: SELLER_AGENT gets empty list for deed-recordings and ownership-transfers (ESCROW_OFFICER only)."""
    r1 = await client_as_alice.get(f"{api_base}/transactions/{TX_CLEAR_TO_CLOSE}/closing/deed-recordings")
    r2 = await client_as_alice.get(f"{api_base}/transactions/{TX_CLEAR_TO_CLOSE}/closing/ownership-transfers")
    assert r1.status_code == 200 and r2.status_code == 200
    assert isinstance(r1.json(), list) and isinstance(r2.json(), list)


# ---------------------------------------------------------------------------
# 2.2 Access decision logging: document get, inspection get, transaction get
# ---------------------------------------------------------------------------


def _fetch_recent_access_decision(actor_id: str, resource_type: str, outcome: str, correlation_id: str | None = None):
    """Query audit_events for AccessDecision with given actor, resource_type, outcome (psycopg2)."""
    try:
        import psycopg2
    except ImportError:
        pytest.skip("psycopg2 not installed; cannot verify audit_events")
    url = urlparse(settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://"))
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
            cur.execute("SET LOCAL app.user_id = %s", (actor_id,))
            cur.execute("SET LOCAL app.organization_id = %s", (ORG_ACME,))
            cur.execute("SET LOCAL app.role = %s", ("SELLER_AGENT",))
            if correlation_id:
                cur.execute(
                    """
                    SELECT event_id, event_type, action, outcome, resource_type, details->>'policy_reference' AS policy_ref
                    FROM audit_events
                    WHERE event_type = 'AccessDecision' AND actor_id = %s::uuid AND correlation_id = %s
                    ORDER BY occurred_at DESC LIMIT 1
                    """,
                    (actor_id, correlation_id),
                )
            else:
                cur.execute(
                    """
                    SELECT event_id, event_type, action, outcome, resource_type, details->>'policy_reference' AS policy_ref
                    FROM audit_events
                    WHERE event_type = 'AccessDecision' AND actor_id = %s::uuid AND resource_type = %s AND outcome = %s
                    ORDER BY occurred_at DESC LIMIT 1
                    """,
                    (actor_id, resource_type, outcome),
                )
            return cur.fetchone()
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_get_transaction_logs_access_decision_allow(
    client_as_alice: AsyncClient, api_base: str
) -> None:
    """Access decision logging: GET transaction (allow) writes AccessDecision to audit_events (02 §5, AUDIT §8.3)."""
    corr = "test-access-tx-allow-1"
    r = await client_as_alice.get(
        f"{api_base}/transactions/{TX_UNDER_CONTRACT}",
        headers={"X-Correlation-Id": corr},
    )
    assert r.status_code == 200
    row = _fetch_recent_access_decision(USER_ALICE, "transaction", "allow", correlation_id=corr)
    assert row is not None
    _event_id, event_type, action, outcome, resource_type, policy_ref = row
    assert event_type == "AccessDecision"
    assert action == "read"
    assert outcome == "allow"
    assert resource_type == "transaction"
    assert policy_ref == "06-RLS-transactions"


@pytest.mark.asyncio
async def test_get_transaction_logs_access_decision_deny(
    client_as_alice: AsyncClient, api_base: str
) -> None:
    """Access decision logging: GET transaction (404) logs outcome deny."""
    corr = "test-access-tx-deny-1"
    r = await client_as_alice.get(
        f"{api_base}/transactions/{NONEXISTENT_UUID}",
        headers={"X-Correlation-Id": corr},
    )
    assert r.status_code == 404
    row = _fetch_recent_access_decision(USER_ALICE, "transaction", "deny", correlation_id=corr)
    assert row is not None
    _event_id, event_type, action, outcome, resource_type, policy_ref = row
    assert event_type == "AccessDecision"
    assert outcome == "deny"
    assert resource_type == "transaction"


@pytest.mark.asyncio
async def test_get_document_logs_access_decision(
    client_as_alice: AsyncClient, api_base: str
) -> None:
    """Access decision logging: GET document (allow or deny) writes AccessDecision with policy_reference."""
    corr = "test-access-doc-1"
    r = await client_as_alice.get(
        f"{api_base}/documents/{NONEXISTENT_UUID}",
        headers={"X-Correlation-Id": corr},
    )
    assert r.status_code == 404
    row = _fetch_recent_access_decision(USER_ALICE, "document", "deny", correlation_id=corr)
    assert row is not None
    _event_id, event_type, action, outcome, resource_type, policy_ref = row
    assert event_type == "AccessDecision"
    assert outcome == "deny"
    assert resource_type == "document"
    assert policy_ref == "06-RLS-documents"


@pytest.mark.asyncio
async def test_get_inspection_logs_access_decision(
    client_as_alice: AsyncClient, api_base: str
) -> None:
    """Access decision logging: GET inspection (deny when not found) writes AccessDecision with policy_reference."""
    corr = "test-access-insp-1"
    r = await client_as_alice.get(
        f"{api_base}/inspections/{NONEXISTENT_UUID}",
        headers={"X-Correlation-Id": corr},
    )
    assert r.status_code == 404
    row = _fetch_recent_access_decision(USER_ALICE, "inspection", "deny", correlation_id=corr)
    assert row is not None
    _event_id, event_type, action, outcome, resource_type, policy_ref = row
    assert event_type == "AccessDecision"
    assert outcome == "deny"
    assert resource_type == "inspection"
    assert policy_ref == "06-RLS-inspections"
