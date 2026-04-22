"""Escrow endpoints: GET list by transaction, POST assign/confirm/record (RLS)."""

import pytest
from httpx import AsyncClient

from tests.conftest import error_code

ORG_ACME = "a0000001-0000-0000-0000-000000000001"
TX_UNDER_CONTRACT = "c0000001-0000-0000-0000-000000000001"
USER_DAVE = "b0000001-0000-0000-0000-000000000004"
USER_ALICE = "b0000001-0000-0000-0000-000000000001"
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"


@pytest.mark.asyncio
async def test_list_escrow_assignments_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/escrow/assignments returns 200 and list (Alice is party on seed tx 001)."""
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/escrow/assignments")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_list_escrow_assignments_not_found(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/escrow/assignments returns 404 for unknown transaction."""
    r = await client_as_alice.get(f"{api_base}/transactions/{NONEXISTENT_UUID}/escrow/assignments")
    assert r.status_code == 404
    assert error_code(r.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_list_earnest_money_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/escrow/earnest-money returns 200 and list."""
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/escrow/earnest-money")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_list_funding_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/escrow/funding returns 200 and list. REGULATED: only ESCROW_OFFICER/LENDER see rows; others get empty list."""
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/escrow/funding")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_list_funding_as_escrow_officer_sees_rows(client_as_alice: AsyncClient, api_base: str) -> None:
    """REGULATED (18 §6): ESCROW_OFFICER can list funding; LENDER can too. Use ESCROW_OFFICER on CLEAR_TO_CLOSE tx."""
    TX_CLEAR = "c0000001-0000-0000-0000-000000000007"
    headers = {"X-User-Id": USER_ALICE, "X-Role": "ESCROW_OFFICER", "X-Organization-Id": ORG_ACME}
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_CLEAR}/escrow/funding", headers=headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_list_disbursements_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/escrow/disbursements returns 200 and list. REGULATED: only ESCROW_OFFICER sees rows."""
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/escrow/disbursements")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_assign_escrow_officer_then_list(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST assign (as ESCROW_OFFICER) then GET list returns the new assignment."""
    r = await client_as_alice.post(
        f"{api_base}/transactions/{TX_UNDER_CONTRACT}/escrow/assignments",
        headers={"X-User-Id": USER_ALICE, "X-Role": "ESCROW_OFFICER", "X-Organization-Id": ORG_ACME},
        json={"escrow_officer_id": USER_DAVE},
    )
    assert r.status_code == 201
    assignment_id = r.json()["assignment_id"]
    list_r = await client_as_alice.get(f"{api_base}/transactions/{TX_UNDER_CONTRACT}/escrow/assignments")
    assert list_r.status_code == 200
    assignments = list_r.json()
    assert any(a["assignment_id"] == assignment_id for a in assignments)


@pytest.mark.asyncio
async def test_confirm_earnest_money_with_amount_notes(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST escrow/earnest-money/confirm with amount and notes returns 201 and body (Phase A.3 form)."""
    r = await client_as_alice.post(
        f"{api_base}/transactions/{TX_UNDER_CONTRACT}/escrow/earnest-money/confirm",
        headers={"X-User-Id": USER_ALICE, "X-Role": "ESCROW_OFFICER", "X-Organization-Id": ORG_ACME},
        json={"amount": 25000.00, "notes": "EMD received via wire"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data.get("amount") == 25000.00
    assert data.get("notes") == "EMD received via wire"
    assert "deposit_id" in data


@pytest.mark.asyncio
async def test_record_disbursement_with_amount_recipient_notes(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST escrow/disbursements with amount, recipient, notes returns 201. REGULATED: ESCROW_OFFICER only, state CLEAR_TO_CLOSE/CLOSED."""
    TX_CLEAR = "c0000001-0000-0000-0000-000000000007"
    r = await client_as_alice.post(
        f"{api_base}/transactions/{TX_CLEAR}/escrow/disbursements",
        headers={"X-User-Id": USER_ALICE, "X-Role": "ESCROW_OFFICER", "X-Organization-Id": ORG_ACME},
        json={"amount": 350000.00, "recipient": "Seller LLC", "notes": "Final payoff"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data.get("amount") == 350000.00
    assert data.get("recipient") == "Seller LLC"
    assert data.get("notes") == "Final payoff"
    assert "disbursement_id" in data
