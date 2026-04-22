"""Appraisal endpoints: create (restricted to LENDER/ESCROW_OFFICER), get, submit."""

import pytest
from httpx import AsyncClient

from tests.conftest import error_code

# Tx 001: UNDER_CONTRACT; org 1; parties include Eve (LENDER), Dave (ESCROW_OFFICER), Bob (BUYER). RLS: only same-org parties see tx.
# Dave is org 2, so cannot see tx 001. Use tx 001 for lender (Eve org 1); use tx 010 for escrow officer (Dave org 2).
TX_ID = "c0000001-0000-0000-0000-000000000001"
TX_ID_ORG2 = "c0000001-0000-0000-0000-000000000010"  # org 2; Dave ESCROW_OFFICER
EVE_LENDER_HEADERS = {
    "X-User-Id": "b0000001-0000-0000-0000-000000000005",
    "X-Role": "LENDER",
    "X-Organization-Id": "a0000001-0000-0000-0000-000000000001",
}
DAVE_ESCROW_HEADERS = {
    "X-User-Id": "b0000001-0000-0000-0000-000000000004",
    "X-Role": "ESCROW_OFFICER",
    "X-Organization-Id": "a0000001-0000-0000-0000-000000000002",
}
BOB_BUYER_HEADERS = {
    "X-User-Id": "b0000001-0000-0000-0000-000000000002",
    "X-Role": "BUYER",
    "X-Organization-Id": "a0000001-0000-0000-0000-000000000001",
}
ANDY_APPRAISER_UUID = "b0000001-0000-0000-0000-000000000015"


@pytest.mark.asyncio
async def test_create_appraisal_as_lender_ok(client: AsyncClient, api_base: str) -> None:
    """POST /transactions/{id}/appraisals as LENDER (party) returns 201."""
    r = await client.post(
        f"{api_base}/transactions/{TX_ID}/appraisals",
        headers=EVE_LENDER_HEADERS,
        json={"appraiser_id": ANDY_APPRAISER_UUID},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["transaction_id"] == TX_ID
    assert data["appraiser_id"] == ANDY_APPRAISER_UUID
    assert "appraisal_id" in data


@pytest.mark.asyncio
async def test_create_appraisal_as_escrow_officer_ok(client: AsyncClient, api_base: str) -> None:
    """POST /transactions/{id}/appraisals as ESCROW_OFFICER (party, same-org) returns 201. Use tx 010 (org 2) so Dave sees it."""
    r = await client.post(
        f"{api_base}/transactions/{TX_ID_ORG2}/appraisals",
        headers=DAVE_ESCROW_HEADERS,
        json={},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["transaction_id"] == TX_ID_ORG2


@pytest.mark.asyncio
async def test_create_appraisal_as_buyer_rejected(client: AsyncClient, api_base: str) -> None:
    """POST /transactions/{id}/appraisals as BUYER returns 422 (only LENDER/ESCROW_OFFICER may order)."""
    r = await client.post(
        f"{api_base}/transactions/{TX_ID}/appraisals",
        headers=BOB_BUYER_HEADERS,
        json={"appraiser_id": ANDY_APPRAISER_UUID},
    )
    assert r.status_code == 422
    assert error_code(r.json()) == "VALIDATION_ERROR"
