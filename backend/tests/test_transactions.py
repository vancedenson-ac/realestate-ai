"""Transaction endpoints: list, get, create, transition."""
import pytest
from httpx import AsyncClient

from tests.conftest import error_code

# Seed UUIDs (from 03-seed.sql)
ORG_ACME = "a0000001-0000-0000-0000-000000000001"
TX_UNDER_CONTRACT = "c0000001-0000-0000-0000-000000000001"
TX_PRE_LISTING = "c0000001-0000-0000-0000-000000000002"
TX_CANCELLED_NOT_PARTY = "c0000001-0000-0000-0000-000000000009"  # CANCELLED; parties Alice+Carol only; Bob must not see
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"
PROP_OAK = "d0000001-0000-0000-0000-000000000001"
LISTING_OAK = "e0000001-0000-0000-0000-000000000001"


@pytest.mark.asyncio
async def test_list_transactions(client: AsyncClient, api_base: str) -> None:
    """GET /transactions returns 200 and list with data + meta."""
    response = await client.get(f"{api_base}/transactions")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert "meta" in data
    assert isinstance(data["data"], list)
    assert "limit" in data["meta"]


@pytest.mark.asyncio
async def test_list_transactions_default_client_excludes_pre_listing(client: AsyncClient, api_base: str) -> None:
    """When no RLS headers are sent, default role is BUYER; list must not include PRE_LISTING (RBAC)."""
    response = await client.get(f"{api_base}/transactions", params={"limit": 100})
    assert response.status_code == 200
    data = response.json()["data"]
    for t in data:
        assert t.get("current_state") != "PRE_LISTING", (
            f"Default client (BUYER) must not see PRE_LISTING transaction {t.get('transaction_id')}"
        )


@pytest.mark.asyncio
async def test_list_transactions_with_limit(client: AsyncClient, api_base: str) -> None:
    """GET /transactions?limit=1 returns at most 1 item."""
    response = await client.get(f"{api_base}/transactions", params={"limit": 1})
    assert response.status_code == 200
    data = response.json()
    assert len(data["data"]) <= 1


@pytest.mark.asyncio
async def test_get_transaction_ok(client: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id} returns 200 for existing transaction."""
    list_resp = await client.get(f"{api_base}/transactions", params={"limit": 1})
    assert list_resp.status_code == 200
    data_list = list_resp.json()["data"]
    if not data_list:
        pytest.skip("Seed data required: run seed.bat")
    txn_id = data_list[0]["transaction_id"]
    response = await client.get(f"{api_base}/transactions/{txn_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["transaction_id"] == txn_id
    assert "current_state" in data
    assert "organization_id" in data


@pytest.mark.asyncio
async def test_get_transaction_not_found(client: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id} returns 404 for unknown id."""
    response = await client.get(f"{api_base}/transactions/{NONEXISTENT_UUID}")
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_buyer_cannot_see_pre_listing_transaction(client_as_bob: AsyncClient, api_base: str) -> None:
    """RLS: BUYER must not see PRE_LISTING transactions (06 explicit deny; 17 journey)."""
    # List must not include PRE_LISTING tx (seed tx 002).
    list_resp = await client_as_bob.get(f"{api_base}/transactions", params={"limit": 50})
    assert list_resp.status_code == 200
    data = list_resp.json()["data"]
    pre_listing_ids = [t["transaction_id"] for t in data if t.get("current_state") == "PRE_LISTING"]
    assert TX_PRE_LISTING not in pre_listing_ids, "Buyer must not see PRE_LISTING in list"
    # Direct get must return 404 (row invisible via RLS).
    get_resp = await client_as_bob.get(f"{api_base}/transactions/{TX_PRE_LISTING}")
    assert get_resp.status_code == 404, "Buyer must get 404 for PRE_LISTING transaction"
    assert error_code(get_resp.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_list_transactions_as_buyer_contains_no_pre_listing(client_as_bob: AsyncClient, api_base: str) -> None:
    """RLS: GET /transactions as BUYER must never return any PRE_LISTING (RBAC/ABAC)."""
    response = await client_as_bob.get(f"{api_base}/transactions", params={"limit": 100})
    assert response.status_code == 200
    data = response.json()["data"]
    for t in data:
        assert t.get("current_state") != "PRE_LISTING", (
            f"Buyer must not see transaction {t.get('transaction_id')} in PRE_LISTING state"
        )


@pytest.mark.asyncio
async def test_buyer_cannot_see_non_party_transaction_list(client_as_bob: AsyncClient, api_base: str) -> None:
    """RLS: BUYER list must not include transactions where they are not a party (except LISTED+public)."""
    response = await client_as_bob.get(f"{api_base}/transactions", params={"limit": 50})
    assert response.status_code == 200
    data = response.json()["data"]
    tx_ids = [t["transaction_id"] for t in data]
    # Tx 009 is CANCELLED; Bob is not a party; must not appear (no LISTED+public path for 009).
    assert TX_CANCELLED_NOT_PARTY not in tx_ids, "Buyer must not see non-party CANCELLED transaction (RLS)"


@pytest.mark.asyncio
async def test_buyer_cannot_see_non_party_transaction_get(client_as_bob: AsyncClient, api_base: str) -> None:
    """RLS: BUYER GET /transactions/{id} for non-party transaction (009) returns 404."""
    response = await client_as_bob.get(f"{api_base}/transactions/{TX_CANCELLED_NOT_PARTY}")
    assert response.status_code == 404, "Buyer must get 404 for non-party transaction (RLS)"
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_create_transaction_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /transactions returns 201 and creates transaction in PRE_LISTING (seller-side)."""
    org_id = ORG_ACME
    response = await client_as_alice.post(
        f"{api_base}/transactions",
        json={"organization_id": org_id, "initial_state": "PRE_LISTING"},
    )
    assert response.status_code == 201
    data = response.json()
    assert "transaction_id" in data
    assert data["current_state"] == "PRE_LISTING"
    assert data["organization_id"] == org_id


@pytest.mark.asyncio
async def test_buyer_create_listed_transaction_for_offer(client_as_bob: AsyncClient, api_base: str) -> None:
    """POST /transactions as BUYER with initial_state=LISTED and listing_id returns 201 (make-offer flow)."""
    # Bob (BUYER) can create a transaction in LISTED with listing_id to start an offer.
    response = await client_as_bob.post(
        f"{api_base}/transactions",
        json={
            "organization_id": ORG_ACME,
            "initial_state": "LISTED",
            "initial_party_role": "BUYER",
            "listing_id": LISTING_OAK,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["current_state"] == "LISTED"
    assert data["listing_id"] == LISTING_OAK


@pytest.mark.asyncio
async def test_buyer_cannot_create_pre_listing(client_as_bob: AsyncClient, api_base: str) -> None:
    """POST /transactions as BUYER with PRE_LISTING returns 422 (buyers can only create LISTED for offers)."""
    response = await client_as_bob.post(
        f"{api_base}/transactions",
        json={"organization_id": ORG_ACME, "initial_state": "PRE_LISTING"},
    )
    assert response.status_code == 422
    assert error_code(response.json()) == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_create_transaction_invalid_initial_state(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /transactions with invalid initial_state returns 400 ILLEGAL_TRANSITION."""
    response = await client_as_alice.post(
        f"{api_base}/transactions",
        json={"organization_id": ORG_ACME, "initial_state": "INVALID_STATE"},
    )
    assert response.status_code == 400
    assert error_code(response.json()) == "ILLEGAL_TRANSITION"


@pytest.mark.asyncio
async def test_create_transaction_with_property_and_listing(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /transactions with property_id and listing_id (new-transaction UI flow) returns 201 and links."""
    response = await client_as_alice.post(
        f"{api_base}/transactions",
        json={
            "organization_id": ORG_ACME,
            "initial_state": "PRE_LISTING",
            "initial_party_role": "SELLER_AGENT",
            "property_id": PROP_OAK,
            "listing_id": LISTING_OAK,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["current_state"] == "PRE_LISTING"
    assert data["organization_id"] == ORG_ACME
    assert data["property_id"] == PROP_OAK
    assert data["listing_id"] == LISTING_OAK
    assert "transaction_id" in data


@pytest.mark.asyncio
async def test_transition_transaction_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /transactions/{id}/transitions with legal transition returns 200 (RLS: create binds current user as party)."""
    org_id = ORG_ACME
    create_resp = await client_as_alice.post(
        f"{api_base}/transactions",
        json={
            "organization_id": org_id,
            "initial_state": "PRE_LISTING",
            "initial_party_role": "SELLER_AGENT",
        },
    )
    assert create_resp.status_code == 201
    txn_id = create_resp.json()["transaction_id"]
    response = await client_as_alice.post(
        f"{api_base}/transactions/{txn_id}/transitions",
        json={"to_state": "CANCELLED", "action": "cancel"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["current_state"] == "CANCELLED"
    assert data["transaction_id"] == txn_id


@pytest.mark.asyncio
async def test_transition_transaction_illegal(client: AsyncClient, api_base: str) -> None:
    """POST /transactions/{id}/transitions with illegal transition returns 400."""
    list_resp = await client.get(f"{api_base}/transactions", params={"limit": 20})
    assert list_resp.status_code == 200
    data_list = list_resp.json()["data"]
    txn_under_contract = next((t for t in data_list if t["current_state"] == "UNDER_CONTRACT"), None)
    if not txn_under_contract:
        pytest.skip("Seed data with UNDER_CONTRACT transaction required: run seed.bat")
    txn_id = txn_under_contract["transaction_id"]
    response = await client.post(
        f"{api_base}/transactions/{txn_id}/transitions",
        headers={"X-Role": "BUYER"},
        json={"to_state": "LISTED", "action": "revert"},
    )
    assert response.status_code == 400
    assert error_code(response.json()) == "ILLEGAL_TRANSITION"


@pytest.mark.asyncio
async def test_transition_transaction_not_found(client: AsyncClient, api_base: str) -> None:
    """POST /transactions/{id}/transitions returns 404 for unknown id."""
    response = await client.post(
        f"{api_base}/transactions/{NONEXISTENT_UUID}/transitions",
        headers={"X-Role": "BUYER"},
        json={"to_state": "CANCELLED"},
    )
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


# Tx 005: DUE_DILIGENCE; allowed_roles for DUE_DILIGENCE→FINANCING are BUYER_AGENT (per 05/17). BUYER (Bob) must get 400.
TX_005_DUE_DILIGENCE = "c0000001-0000-0000-0000-000000000005"


@pytest.mark.asyncio
async def test_wrong_role_transition_returns_400(client_as_bob: AsyncClient, api_base: str) -> None:
    """POST transition with role not in allowed_roles returns 400 ILLEGAL_TRANSITION (Phase 4.4)."""
    response = await client_as_bob.post(
        f"{api_base}/transactions/{TX_005_DUE_DILIGENCE}/transitions",
        json={"to_state": "FINANCING", "action": "approve_funding"},
    )
    assert response.status_code == 400
    assert error_code(response.json()) == "ILLEGAL_TRANSITION"
