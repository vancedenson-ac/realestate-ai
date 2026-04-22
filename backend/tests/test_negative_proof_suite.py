"""
Negative proof suite (1.4, 11-testing-and-proof-suite, AUDIT §9).

(a) Cross-org isolation: org B cannot see or access org A's data.
(b) Wrong-role transition: legal edge but caller role not in allowed_roles → 400.
(c) Illegal (from_state, to_state) matrix: every non-listed transition rejected.
(d) No domain_event / event_outbox row emitted on failed transition.
"""

import os
from urllib.parse import urlparse

import pytest
from httpx import AsyncClient

from realtrust_api.config import settings
from tests.conftest import error_code

# Seed: Acme org 001, First Escrow 002, Sunset Lending 003. Tx 001–009 Acme; 010 org 002; 011 org 003.
TX_ACME_001 = "c0000001-0000-0000-0000-000000000001"  # UNDER_CONTRACT
TX_ACME_002 = "c0000001-0000-0000-0000-000000000002"  # PRE_LISTING
TX_ACME_007 = "c0000001-0000-0000-0000-000000000007"  # CLEAR_TO_CLOSE

# Legal (from_state, to_state) from 03-seed.sql (transaction_state_transitions)
LEGAL_TRANSITIONS = {
    ("PRE_LISTING", "LISTED"),
    ("PRE_LISTING", "CANCELLED"),
    ("LISTED", "OFFER_MADE"),
    ("LISTED", "CANCELLED"),
    ("OFFER_MADE", "LISTED"),
    ("OFFER_MADE", "UNDER_CONTRACT"),
    ("OFFER_MADE", "CANCELLED"),
    ("UNDER_CONTRACT", "DUE_DILIGENCE"),
    ("UNDER_CONTRACT", "CANCELLED"),
    ("DUE_DILIGENCE", "FINANCING"),
    ("FINANCING", "CLEAR_TO_CLOSE"),
    ("CLEAR_TO_CLOSE", "CLOSED"),
}
STATES = [
    "PRE_LISTING", "LISTED", "OFFER_MADE", "UNDER_CONTRACT",
    "DUE_DILIGENCE", "FINANCING", "CLEAR_TO_CLOSE", "CLOSED", "CANCELLED",
]
# One seeded Acme tx per state (for illegal-matrix tests)
TX_BY_STATE = {
    "UNDER_CONTRACT": TX_ACME_001,
    "PRE_LISTING": TX_ACME_002,
    "LISTED": "c0000001-0000-0000-0000-000000000003",
    "OFFER_MADE": "c0000001-0000-0000-0000-000000000004",
    "DUE_DILIGENCE": "c0000001-0000-0000-0000-000000000005",
    "FINANCING": "c0000001-0000-0000-0000-000000000006",
    "CLEAR_TO_CLOSE": TX_ACME_007,
    "CLOSED": "c0000001-0000-0000-0000-000000000008",
    "CANCELLED": "c0000001-0000-0000-0000-000000000009",
}


# ---------------------------------------------------------------------------
# (a) Cross-org isolation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cross_org_isolation_get_returns_404(
    client_as_dave: AsyncClient, api_base: str
) -> None:
    """User in org 002 (First Escrow) cannot GET a transaction that belongs to org 001 (Acme). RLS hides it → 404."""
    r = await client_as_dave.get(f"{api_base}/transactions/{TX_ACME_001}")
    assert r.status_code == 404
    assert error_code(r.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_cross_org_isolation_list_excludes_other_org(
    client_as_dave: AsyncClient, api_base: str
) -> None:
    """User in org 002 listing transactions must not see org 001 transactions (RLS)."""
    r = await client_as_dave.get(f"{api_base}/transactions", params={"limit": 50})
    assert r.status_code == 200
    data = r.json().get("data") or []
    tx_ids = [t["transaction_id"] for t in data]
    assert TX_ACME_001 not in tx_ids, "Org 002 user must not see Acme transaction 001"
    assert TX_ACME_007 not in tx_ids, "Org 002 user must not see Acme transaction 007"


@pytest.mark.asyncio
async def test_cross_org_isolation_transition_forbidden(
    client_as_dave: AsyncClient, api_base: str
) -> None:
    """User in org 002 cannot POST transition on org 001 transaction (RLS: tx not visible → 404)."""
    r = await client_as_dave.post(
        f"{api_base}/transactions/{TX_ACME_001}/transitions",
        json={"to_state": "CANCELLED"},
    )
    assert r.status_code == 404
    assert error_code(r.json()) == "NOT_FOUND"


# ---------------------------------------------------------------------------
# (b) Wrong-role transition tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_buyer_cannot_execute_pre_listing_to_listed(
    client_as_bob: AsyncClient, api_base: str
) -> None:
    """BUYER cannot execute PRE_LISTING → LISTED (only SELLER_AGENT allowed).
    RLS may hide PRE_LISTING from BUYER → 404; or API returns 400 ILLEGAL_TRANSITION if visible."""
    r = await client_as_bob.post(
        f"{api_base}/transactions/{TX_ACME_002}/transitions",
        json={"to_state": "LISTED"},
    )
    assert r.status_code in (400, 404)
    if r.status_code == 400:
        assert error_code(r.json()) == "ILLEGAL_TRANSITION"
    else:
        assert error_code(r.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_seller_agent_cannot_execute_clear_to_close_to_closed(
    client_as_alice: AsyncClient, api_base: str
) -> None:
    """SELLER_AGENT cannot execute CLEAR_TO_CLOSE → CLOSED (only ESCROW_OFFICER allowed)."""
    r = await client_as_alice.post(
        f"{api_base}/transactions/{TX_ACME_007}/transitions",
        json={"to_state": "CLOSED"},
    )
    assert r.status_code == 400
    assert error_code(r.json()) == "ILLEGAL_TRANSITION"


@pytest.mark.asyncio
async def test_buyer_cannot_execute_due_diligence_to_financing(
    client_as_bob: AsyncClient, api_base: str
) -> None:
    """BUYER cannot execute DUE_DILIGENCE → FINANCING (only BUYER_AGENT allowed). Already in test_transactions as test_wrong_role_transition_returns_400; duplicate here for suite."""
    r = await client_as_bob.post(
        f"{api_base}/transactions/{TX_BY_STATE['DUE_DILIGENCE']}/transitions",
        json={"to_state": "FINANCING"},
    )
    assert r.status_code == 400
    assert error_code(r.json()) == "ILLEGAL_TRANSITION"


# ---------------------------------------------------------------------------
# (c) Illegal (from_state, to_state) matrix
# ---------------------------------------------------------------------------


def _illegal_transition_pairs():
    """All (from_state, to_state) pairs that are not in LEGAL_TRANSITIONS."""
    for from_s in STATES:
        for to_s in STATES:
            if (from_s, to_s) not in LEGAL_TRANSITIONS:
                yield from_s, to_s


# Build list for parametrize (exclude terminal→same to avoid no-op; we want rejected attempts)
ILLEGAL_PAIRS = [
    (f, t) for f, t in _illegal_transition_pairs()
    if f != t  # skip self-loops for terminal states
]


@pytest.mark.asyncio
@pytest.mark.parametrize("from_state,to_state", ILLEGAL_PAIRS)
async def test_illegal_state_transition_rejected(
    client_as_alice: AsyncClient,
    api_base: str,
    from_state: str,
    to_state: str,
) -> None:
    """Every illegal (from_state, to_state) transition is rejected with 400 ILLEGAL_TRANSITION."""
    tx_id = TX_BY_STATE.get(from_state)
    if not tx_id:
        pytest.skip(f"No seeded tx for from_state={from_state}")
    r = await client_as_alice.post(
        f"{api_base}/transactions/{tx_id}/transitions",
        json={"to_state": to_state},
    )
    assert r.status_code == 400, (
        f"Expected 400 for {from_state} → {to_state}, got {r.status_code}: {r.text}"
    )
    assert error_code(r.json()) == "ILLEGAL_TRANSITION"


# ---------------------------------------------------------------------------
# (d) No event emitted on failed transition
# ---------------------------------------------------------------------------


def _count_domain_events_for_transaction(transaction_id: str) -> int:
    """Query domain_events for this transaction (admin connection, no RLS)."""
    try:
        import psycopg2
    except ImportError:
        pytest.skip("psycopg2 not installed; cannot verify domain_events")
    url = urlparse(settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://"))
    conn = psycopg2.connect(
        host=url.hostname or "localhost",
        port=url.port or 5432,
        user=os.environ.get("REALTRUST_DB_ADMIN_USER") or url.username or "realtrust",
        password=os.environ.get("REALTRUST_DB_ADMIN_PASSWORD") or url.password or "realtrust",
        dbname=(url.path or "/realtrust").lstrip("/") or "realtrust",
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM domain_events WHERE transaction_id = %s::uuid",
                (transaction_id,),
            )
            return cur.fetchone()[0]
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_no_event_emitted_on_wrong_role_transition(
    client_as_bob: AsyncClient, api_base: str
) -> None:
    """When transition fails (wrong role), no new domain_event is emitted for that transaction."""
    tx_id = TX_BY_STATE["DUE_DILIGENCE"]
    count_before = _count_domain_events_for_transaction(tx_id)
    r = await client_as_bob.post(
        f"{api_base}/transactions/{tx_id}/transitions",
        json={"to_state": "FINANCING"},
    )
    assert r.status_code == 400
    assert error_code(r.json()) == "ILLEGAL_TRANSITION"
    count_after = _count_domain_events_for_transaction(tx_id)
    assert count_after == count_before, (
        f"Expected no new domain_event on failed transition; before={count_before}, after={count_after}"
    )


@pytest.mark.asyncio
async def test_no_event_emitted_on_illegal_transition(
    client_as_alice: AsyncClient, api_base: str
) -> None:
    """When transition fails (illegal from→to), no new domain_event is emitted."""
    tx_id = TX_ACME_001  # UNDER_CONTRACT
    count_before = _count_domain_events_for_transaction(tx_id)
    r = await client_as_alice.post(
        f"{api_base}/transactions/{tx_id}/transitions",
        json={"to_state": "LISTED"},
    )
    assert r.status_code == 400
    assert error_code(r.json()) == "ILLEGAL_TRANSITION"
    count_after = _count_domain_events_for_transaction(tx_id)
    assert count_after == count_before, (
        f"Expected no new domain_event on failed transition; before={count_before}, after={count_after}"
    )
