"""Offer endpoints: submit/list (journey milestones)."""

import pytest
from httpx import AsyncClient

from tests.conftest import error_code

ORG_ACME = "a0000001-0000-0000-0000-000000000001"
LISTING_ID = "e0000001-0000-0000-0000-000000000001"
PROPERTY_ID = "d0000001-0000-0000-0000-000000000001"

RLS_ALICE = {"X-User-Id": "b0000001-0000-0000-0000-000000000001", "X-Role": "SELLER_AGENT", "X-Organization-Id": ORG_ACME}
RLS_BOB = {"X-User-Id": "b0000001-0000-0000-0000-000000000002", "X-Role": "BUYER", "X-Organization-Id": ORG_ACME}


@pytest.mark.asyncio
async def test_submit_offer_ok(client_as_alice: AsyncClient, client_as_bob: AsyncClient, api_base: str) -> None:
    """Buyer can submit offer against a LISTED transaction backed by a public listing."""
    create_tx = await client_as_alice.post(
        f"{api_base}/transactions",
        headers={"X-Role": "SELLER_AGENT"},
        json={
            "organization_id": ORG_ACME,
            "initial_state": "LISTED",
            "initial_party_role": "SELLER_AGENT",
            "property_id": PROPERTY_ID,
            "listing_id": LISTING_ID,
        },
    )
    assert create_tx.status_code == 201
    tx_id = create_tx.json()["transaction_id"]

    r = await client_as_bob.post(
        f"{api_base}/transactions/{tx_id}/offers",
        headers={"X-Role": "BUYER"},
        json={"terms": {"price": 500000}},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["transaction_id"] == tx_id
    assert data["status"] == "SUBMITTED"


@pytest.mark.asyncio
async def test_list_offers_ok(client_as_alice: AsyncClient, client_as_bob: AsyncClient, api_base: str) -> None:
    """Offers list is available (RLS-filtered)."""
    create_tx = await client_as_alice.post(
        f"{api_base}/transactions",
        headers={"X-Role": "SELLER_AGENT"},
        json={
            "organization_id": ORG_ACME,
            "initial_state": "LISTED",
            "initial_party_role": "SELLER_AGENT",
            "property_id": PROPERTY_ID,
            "listing_id": LISTING_ID,
        },
    )
    assert create_tx.status_code == 201
    tx_id = create_tx.json()["transaction_id"]
    submit = await client_as_bob.post(
        f"{api_base}/transactions/{tx_id}/offers",
        headers={"X-Role": "BUYER"},
        json={"terms": {"price": 500000}},
    )
    assert submit.status_code == 201
    r = await client_as_bob.get(f"{api_base}/transactions/{tx_id}/offers", headers={"X-Role": "BUYER"})
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# Seeded tx 004 (OFFER_MADE) has one offer (03-seed.sql); Alice is SELLER_AGENT.
TX_004_OFFER_MADE = "c0000001-0000-0000-0000-000000000004"


@pytest.mark.asyncio
async def test_accept_offer_without_signed_pa_returns_412(
    client_as_alice: AsyncClient, api_base: str
) -> None:
    """Accept offer requires signed purchase_agreement; unsigned doc returns 412 PRECONDITION_FAILED (Phase 4.4)."""
    tx_id = TX_004_OFFER_MADE
    list_offers = await client_as_alice.get(f"{api_base}/transactions/{tx_id}/offers")
    assert list_offers.status_code == 200
    offers = list_offers.json()
    if not offers:
        pytest.skip("Seed data required: run seed (03-seed.sql) so tx 004 has at least one offer")
    offer_id = offers[0]["offer_id"]
    # Create purchase_agreement document but do NOT sign it.
    create_doc = await client_as_alice.post(
        f"{api_base}/transactions/{tx_id}/documents",
        json={"document_type": "purchase_agreement"},
    )
    assert create_doc.status_code == 201
    doc_id = create_doc.json()["document_id"]
    ver = await client_as_alice.post(
        f"{api_base}/documents/{doc_id}/versions",
        json={"storage_path": "test/pa", "storage_bucket": "realtrust-test", "checksum": "abc"},
    )
    assert ver.status_code == 201
    # Accept with unsigned PA → 412
    r = await client_as_alice.post(
        f"{api_base}/offers/{offer_id}/accept",
        json={"purchase_agreement_document_id": doc_id, "reason": "Test"},
    )
    assert r.status_code == 412
    assert error_code(r.json()) == "PRECONDITION_FAILED"

