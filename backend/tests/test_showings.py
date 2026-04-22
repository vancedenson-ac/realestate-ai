"""Showing endpoints: schedule/list/update, showing_type, showing_feedback."""

import pytest
from httpx import AsyncClient

LISTING_ID = "e0000001-0000-0000-0000-000000000001"

# Alice is SELLER_AGENT, can create showings and add feedback (listing agent for this listing)
ALICE_HEADERS = {
    "X-User-Id": "b0000001-0000-0000-0000-000000000001",
    "X-Role": "SELLER_AGENT",
    "X-Organization-Id": "a0000001-0000-0000-0000-000000000001",
}


@pytest.mark.asyncio
async def test_schedule_showing_ok(client_as_bob: AsyncClient, api_base: str) -> None:
    r = await client_as_bob.post(
        f"{api_base}/listings/{LISTING_ID}/showings",
        json={"scheduled_start_at": "2030-01-01T10:00:00Z", "notes": "Please confirm access."},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["listing_id"] == LISTING_ID
    assert data["status"] == "SCHEDULED"
    assert data.get("showing_type") == "PRIVATE"


@pytest.mark.asyncio
async def test_schedule_showing_with_open_house_type(client_as_alice: AsyncClient, api_base: str) -> None:
    """Schedule showing with showing_type OPEN_HOUSE; response includes showing_type."""
    r = await client_as_alice.post(
        f"{api_base}/listings/{LISTING_ID}/showings",
        json={
            "scheduled_start_at": "2030-02-01T14:00:00Z",
            "scheduled_end_at": "2030-02-01T16:00:00Z",
            "showing_type": "OPEN_HOUSE",
            "notes": "Open house weekend.",
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["showing_type"] == "OPEN_HOUSE"
    showing_id = data["showing_id"]

    # Update to PRIVATE
    patch_r = await client_as_alice.patch(
        f"{api_base}/showings/{showing_id}",
        json={"showing_type": "PRIVATE"},
    )
    assert patch_r.status_code == 200
    assert patch_r.json()["showing_type"] == "PRIVATE"


@pytest.mark.asyncio
async def test_list_showings_ok(client_as_bob: AsyncClient, api_base: str) -> None:
    r = await client_as_bob.get(f"{api_base}/listings/{LISTING_ID}/showings")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_showing_feedback_list_and_add(client_as_alice: AsyncClient, api_base: str) -> None:
    """List feedback (empty), add feedback as listing agent, list again."""
    # Create a showing first (Alice is listing agent for LISTING_ID)
    create = await client_as_alice.post(
        f"{api_base}/listings/{LISTING_ID}/showings",
        json={"scheduled_start_at": "2030-03-01T10:00:00Z", "showing_type": "PRIVATE"},
    )
    assert create.status_code == 201
    showing_id = create.json()["showing_id"]

    list_r = await client_as_alice.get(f"{api_base}/showings/{showing_id}/feedback")
    assert list_r.status_code == 200
    assert list_r.json() == []

    add_r = await client_as_alice.post(
        f"{api_base}/showings/{showing_id}/feedback",
        json={"rating": "POSITIVE", "notes": "Buyer very interested."},
    )
    assert add_r.status_code == 201
    fb = add_r.json()
    assert fb["showing_id"] == showing_id
    assert fb["rating"] == "POSITIVE"
    assert fb["notes"] == "Buyer very interested."
    assert "feedback_id" in fb and "from_user_id" in fb

    list_r2 = await client_as_alice.get(f"{api_base}/showings/{showing_id}/feedback")
    assert list_r2.status_code == 200
    assert len(list_r2.json()) == 1
    assert list_r2.json()[0]["rating"] == "POSITIVE"


@pytest.mark.asyncio
async def test_showing_feedback_forbidden_when_not_listing_agent_or_broker(
    client_as_alice: AsyncClient,
    client_as_dave: AsyncClient,
    api_base: str,
) -> None:
    """User in another org (Dave Escrow) cannot add showing feedback; only listing agent or broker can. Returns 403 FORBIDDEN_BY_POLICY."""
    # Alice (listing agent, Acme) creates a showing for LISTING_ID (broker = Acme)
    create = await client_as_alice.post(
        f"{api_base}/listings/{LISTING_ID}/showings",
        json={"scheduled_start_at": "2030-04-01T10:00:00Z", "showing_type": "PRIVATE"},
    )
    assert create.status_code == 201
    showing_id = create.json()["showing_id"]

    # Dave (Escrow, First Escrow Co — not listing agent, not broker) tries to add feedback -> 403
    add_r = await client_as_dave.post(
        f"{api_base}/showings/{showing_id}/feedback",
        json={"rating": "NEUTRAL", "notes": "looked good"},
    )
    assert add_r.status_code == 403
    data = add_r.json()
    assert (data.get("detail") or {}).get("error", {}).get("code") == "FORBIDDEN_BY_POLICY"
    assert "listing agent" in (data.get("detail") or {}).get("error", {}).get("message", "").lower()

