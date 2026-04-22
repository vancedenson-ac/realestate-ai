"""Title/closing endpoints: GET list by transaction, POST create (RLS)."""

import pytest
from httpx import AsyncClient

from tests.conftest import error_code

ORG_ACME = "a0000001-0000-0000-0000-000000000001"
TX_UNDER_CONTRACT = "c0000001-0000-0000-0000-000000000001"
USER_ALICE = "b0000001-0000-0000-0000-000000000001"
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"

RLS_HEADERS = {
    "X-User-Id": USER_ALICE,
    "X-Role": "SELLER_AGENT",
    "X-Organization-Id": ORG_ACME,
}


@pytest.mark.asyncio
async def test_list_title_orders_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/title/orders returns 200 and list."""
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/title/orders")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_list_title_orders_not_found(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/title/orders returns 404 for unknown transaction."""
    r = await client_as_alice.get(f"{api_base}/transactions/{NONEXISTENT_UUID}/title/orders")
    assert r.status_code == 404
    assert error_code(r.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_list_title_commitments_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/title/commitments returns 200 and list."""
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/title/commitments")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_list_deed_recordings_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/closing/deed-recordings returns 200 and list. REGULATED: only ESCROW_OFFICER sees rows."""
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/closing/deed-recordings")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_list_ownership_transfers_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/closing/ownership-transfers returns 200 and list. REGULATED: only ESCROW_OFFICER sees rows."""
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/closing/ownership-transfers")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_create_title_order_then_list(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST title/orders then GET list returns the new order."""
    r = await client_as_alice.post(
        f"{api_base}/transactions/{TX_UNDER_CONTRACT}/title/orders",
        json={"status": "ORDERED"},
    )
    assert r.status_code == 201
    order_id = r.json()["title_order_id"]
    list_r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/title/orders")
    assert list_r.status_code == 200
    orders = list_r.json()
    assert any(o["title_order_id"] == order_id for o in orders)


# ---------------------------------------------------------------------------
# Appraisal waivers (list + waive)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_appraisal_waivers_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/appraisals/waivers returns 200 and list."""
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/appraisals/waivers")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_list_appraisal_waivers_not_found(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/appraisals/waivers returns 404 for unknown transaction."""
    r = await client_as_alice.get(f"{api_base}/transactions/{NONEXISTENT_UUID}/appraisals/waivers")
    assert r.status_code == 404
    assert error_code(r.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_waive_appraisal_creates_waiver(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /transactions/{id}/appraisals/waive returns 201 and waiver body."""
    r = await client_as_alice.post(
        f"{api_base}/transactions/{TX_UNDER_CONTRACT}/appraisals/waive",
        json={"reason": "Test waiver for title tests"},
    )
    assert r.status_code == 201
    body = r.json()
    assert "waiver_id" in body
    assert body["transaction_id"] == TX_UNDER_CONTRACT
    assert body["waived_by_user_id"] == USER_ALICE
    assert body.get("reason") == "Test waiver for title tests"
    assert "waived_at" in body


@pytest.mark.asyncio
async def test_waive_appraisal_not_found(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /transactions/{id}/appraisals/waive returns 404 for unknown transaction."""
    r = await client_as_alice.post(
        f"{api_base}/transactions/{NONEXISTENT_UUID}/appraisals/waive",
        json={},
    )
    assert r.status_code == 404
    assert error_code(r.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_list_appraisal_waivers_after_waive(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST waive then GET appraisals/waivers returns the new waiver."""
    # Use a transaction that may not have waivers yet: list first
    list_before = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/appraisals/waivers")
    assert list_before.status_code == 200
    before = list_before.json()
    # Create a waiver
    waive_r = await client_as_alice.post(
        f"{api_base}/transactions/{TX_UNDER_CONTRACT}/appraisals/waive",
        json={"reason": "E2E list-after-waive"},
    )
    assert waive_r.status_code == 201
    waiver_id = waive_r.json()["waiver_id"]
    list_after = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/appraisals/waivers")
    assert list_after.status_code == 200
    after = list_after.json()
    assert len(after) >= 1
    assert any(w["waiver_id"] == waiver_id for w in after)


# ---------------------------------------------------------------------------
# Phase A.3: Deed recording and ownership transfer with form fields
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_record_deed_with_recording_reference(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST closing/deed-recorded returns 201. REGULATED: ESCROW_OFFICER only, state CLEAR_TO_CLOSE/CLOSED (18 §6)."""
    TX_CLEAR = "c0000001-0000-0000-0000-000000000007"
    r = await client_as_alice.post(
        f"{api_base}/transactions/{TX_CLEAR}/closing/deed-recorded",
        headers={"X-User-Id": USER_ALICE, "X-Role": "ESCROW_OFFICER", "X-Organization-Id": ORG_ACME},
        json={"recording_reference": "Book 12345 Page 67"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data.get("recording_reference") == "Book 12345 Page 67"
    assert "recording_id" in data


@pytest.mark.asyncio
async def test_record_ownership_transfer_with_notes(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST closing/ownership-transfer returns 201. REGULATED: ESCROW_OFFICER only, state CLEAR_TO_CLOSE/CLOSED (18 §6)."""
    TX_CLEAR = "c0000001-0000-0000-0000-000000000007"
    r = await client_as_alice.post(
        f"{api_base}/transactions/{TX_CLEAR}/closing/ownership-transfer",
        headers={"X-User-Id": USER_ALICE, "X-Role": "ESCROW_OFFICER", "X-Organization-Id": ORG_ACME},
        json={"notes": "Title transferred to buyer per deed."},
    )
    assert r.status_code == 201
    data = r.json()
    assert data.get("notes") == "Title transferred to buyer per deed."
    assert "transfer_id" in data
