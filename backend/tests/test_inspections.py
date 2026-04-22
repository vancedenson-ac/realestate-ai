"""Inspection endpoints: GET list by transaction, POST create, POST submit (RLS)."""

import pytest
from httpx import AsyncClient

from tests.conftest import error_code

ORG_ACME = "a0000001-0000-0000-0000-000000000001"
TX_UNDER_CONTRACT = "c0000001-0000-0000-0000-000000000001"
USER_IVY = "b0000001-0000-0000-0000-000000000013"
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"

RLS_HEADERS_ALICE = {
    "X-User-Id": "b0000001-0000-0000-0000-000000000001",
    "X-Role": "SELLER_AGENT",
    "X-Organization-Id": ORG_ACME,
}
# Eve is LENDER on tx 001 (03-seed); inspections RLS denies LENDER (only BUYER, BUYER_AGENT, SELLER, SELLER_AGENT, ESCROW_OFFICER, INSPECTOR).
RLS_HEADERS_EVE_LENDER = {
    "X-User-Id": "b0000001-0000-0000-0000-000000000005",
    "X-Role": "LENDER",
    "X-Organization-Id": ORG_ACME,
}


@pytest.mark.asyncio
async def test_list_inspections_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/inspections returns 200 and list."""
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/inspections")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_list_inspections_not_found(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/inspections returns 404 for unknown transaction."""
    r = await client_as_alice.get(f"{api_base}/transactions/{NONEXISTENT_UUID}/inspections")
    assert r.status_code == 404
    assert error_code(r.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_create_inspection_then_list(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST create inspection then GET list returns the new inspection."""
    from datetime import datetime, timezone
    scheduled = (datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z")
    r = await client_as_alice.post(
        f"{api_base}/transactions/{TX_UNDER_CONTRACT}/inspections",
        json={"inspector_id": USER_IVY, "scheduled_at": scheduled},
    )
    assert r.status_code == 201
    data = r.json()
    assert "inspection_id" in data
    assert data["transaction_id"] == TX_UNDER_CONTRACT
    assert data["status"] == "scheduled"
    list_r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/inspections")
    assert list_r.status_code == 200
    inspections = list_r.json()
    assert any(i["inspection_id"] == data["inspection_id"] for i in inspections)


@pytest.mark.asyncio
async def test_lender_sees_empty_inspections_list(client: AsyncClient, api_base: str) -> None:
    """RLS: LENDER on a transaction gets empty inspections list (06 explicit deny; Phase 4.4)."""
    # Tx 001 has Eve as LENDER; inspections policy allows only BUYER, BUYER_AGENT, SELLER, SELLER_AGENT, ESCROW_OFFICER, INSPECTOR.
    r = await client.get(
        f"{api_base}/transactions/{TX_UNDER_CONTRACT}/inspections",
        headers=RLS_HEADERS_EVE_LENDER,
    )
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) == 0, "LENDER must not see any inspection rows (RLS denies)"
