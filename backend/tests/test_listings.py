"""Listing endpoints: list, get, create, update."""
import pytest
from httpx import AsyncClient

from tests.conftest import error_code

# Seed UUIDs (from 03-seed.sql)
LISTING_1 = "e0000001-0000-0000-0000-000000000001"
LISTING_2 = "e0000001-0000-0000-0000-000000000002"
LISTING_DRAFT_ACME = "e0000001-0000-0000-0000-000000000026"  # DRAFT, broker=Acme; BUYER must not see
PROP_OAK = "d0000001-0000-0000-0000-000000000001"
PROP_ELM = "d0000001-0000-0000-0000-000000000002"
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"
ORG_ACME = "a0000001-0000-0000-0000-000000000001"


@pytest.mark.asyncio
async def test_list_listings(client: AsyncClient, api_base: str) -> None:
    """GET /listings returns 200 and list with data + meta. Each item includes property address fields."""
    response = await client.get(f"{api_base}/listings")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert "meta" in data
    assert isinstance(data["data"], list)
    for item in data["data"]:
        assert "address_line_1" in item
        assert "city" in item
        assert "state_province" in item
        assert "postal_code" in item
        assert "country" in item


@pytest.mark.asyncio
async def test_list_listings_with_params(client: AsyncClient, api_base: str) -> None:
    """GET /listings?limit=1&status_filter=ACTIVE returns 200."""
    response = await client.get(
        f"{api_base}/listings",
        params={"limit": 1, "status_filter": "ACTIVE"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["data"]) <= 1
    for item in data["data"]:
        assert item.get("status") == "ACTIVE"


@pytest.mark.asyncio
async def test_list_listings_search(client: AsyncClient, api_base: str) -> None:
    """GET /listings?search=... filters by address, city, state, or postal code (ILIKE)."""
    # Seed has Scottsdale, Phoenix, etc. Search for Scottsdale should return only Scottsdale listings.
    response = await client.get(
        f"{api_base}/listings",
        params={"limit": 50, "search": "Scottsdale"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    for item in data["data"]:
        assert "Scottsdale" in (item.get("city") or "") or "Scottsdale" in (item.get("address_line_1") or "")
    # Nonexistent search returns empty or fewer results
    empty = await client.get(
        f"{api_base}/listings",
        params={"limit": 50, "search": "nonexistentcity123xyz"},
    )
    assert empty.status_code == 200
    assert len(empty.json()["data"]) == 0


@pytest.mark.asyncio
async def test_get_listing_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /listings/{id} returns 200 for existing listing. Create as SELLER_AGENT (RLS allows insert)."""
    prop = await client_as_alice.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "789 Listing St",
            "city": "Austin",
            "state_province": "TX",
            "postal_code": "78703",
            "country": "US",
            "property_type": "SINGLE_FAMILY",
        },
    )
    assert prop.status_code == 201
    property_id = prop.json()["property_id"]
    create = await client_as_alice.post(
        f"{api_base}/listings",
        json={"property_id": property_id, "list_price": 500000, "listing_type": "FOR_SALE"},
    )
    assert create.status_code == 201
    listing_id = create.json()["listing_id"]
    response = await client_as_alice.get(f"{api_base}/listings/{listing_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["listing_id"] == listing_id
    assert data["property_id"] == property_id
    assert float(data["list_price"]) == 500000
    assert data.get("address_line_1") == "789 Listing St"
    assert data.get("city") == "Austin"
    assert data.get("state_province") == "TX"
    assert "postal_code" in data
    assert "country" in data


@pytest.mark.asyncio
async def test_get_listing_not_found(client: AsyncClient, api_base: str) -> None:
    """GET /listings/{id} returns 404 for unknown id."""
    response = await client.get(f"{api_base}/listings/{NONEXISTENT_UUID}")
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_404_error_response_shape_for_frontend_toast(client: AsyncClient, api_base: str) -> None:
    """404 response has detail.error.code and detail.error.message so frontend can show toast (20-api-contract)."""
    response = await client.get(f"{api_base}/listings/{NONEXISTENT_UUID}")
    assert response.status_code == 404
    data = response.json()
    detail = data.get("detail") or {}
    error = detail.get("error") or {}
    assert error.get("code") == "NOT_FOUND"
    assert isinstance(error.get("message"), str) and len(error["message"]) > 0


@pytest.mark.asyncio
async def test_get_listing_returns_404_when_rls_denies(
    client_as_alice: AsyncClient, client_as_bob: AsyncClient, api_base: str
) -> None:
    """GET /listings/{id} returns 404 when listing is not visible to caller (non-public; RBAC)."""
    # Alice creates a non-public listing
    prop = await client_as_alice.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "1 Private Dr",
            "city": "Austin",
            "state_province": "TX",
            "postal_code": "78701",
            "country": "US",
            "property_type": "SINGLE_FAMILY",
        },
    )
    assert prop.status_code == 201
    property_id = prop.json()["property_id"]
    create = await client_as_alice.post(
        f"{api_base}/listings",
        json={
            "property_id": property_id,
            "list_price": 300000,
            "listing_type": "FOR_SALE",
            "is_public": False,
        },
    )
    assert create.status_code == 201
    listing_id = create.json()["listing_id"]
    # Bob (BUYER) cannot see non-public listing where he is not agent/broker -> 404
    response = await client_as_bob.get(f"{api_base}/listings/{listing_id}")
    assert response.status_code == 404, "Buyer must get 404 for non-public listing (RLS)"
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_buyer_cannot_see_draft_listing_list(client_as_bob: AsyncClient, api_base: str) -> None:
    """RLS: BUYER list must not include DRAFT listings (06; same-org broker bypass denied for buyers)."""
    response = await client_as_bob.get(f"{api_base}/listings", params={"limit": 50})
    assert response.status_code == 200
    data = response.json()["data"]
    listing_ids = [item["listing_id"] for item in data]
    assert LISTING_DRAFT_ACME not in listing_ids, "Buyer must not see DRAFT listing in list (RLS)"


@pytest.mark.asyncio
async def test_buyer_cannot_see_draft_listing_get(client_as_bob: AsyncClient, api_base: str) -> None:
    """RLS: BUYER GET /listings/{id} for DRAFT listing (broker=Acme) returns 404."""
    response = await client_as_bob.get(f"{api_base}/listings/{LISTING_DRAFT_ACME}")
    assert response.status_code == 404, "Buyer must get 404 for DRAFT listing (RLS)"
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_create_listing_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /listings returns 201 and creates listing for property. Use SELLER_AGENT (RLS allows insert)."""
    prop = await client_as_alice.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "999 Create Ln",
            "city": "Austin",
            "state_province": "TX",
            "postal_code": "78704",
            "country": "US",
            "property_type": "SINGLE_FAMILY",
        },
    )
    assert prop.status_code == 201
    property_id = prop.json()["property_id"]
    response = await client_as_alice.post(
        f"{api_base}/listings",
        json={
            "property_id": property_id,
            "list_price": 399000,
            "listing_type": "FOR_SALE",
            "description": "Test listing",
            "is_public": True,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["property_id"] == property_id
    assert float(data["list_price"]) == 399000
    assert data["listing_type"] == "FOR_SALE"
    assert "listing_id" in data
    assert data.get("address_line_1") == "999 Create Ln"
    assert data.get("city") == "Austin"
    assert data.get("state_province") == "TX"


@pytest.mark.asyncio
async def test_create_listing_validation_fails(client: AsyncClient, api_base: str) -> None:
    """POST /listings with invalid payload returns 422."""
    response = await client.post(
        f"{api_base}/listings",
        json={"property_id": PROP_OAK, "list_price": -100},  # invalid price
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_update_listing_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """PATCH /listings/{id} returns 200 and updates fields. Create as SELLER_AGENT (RLS allows insert)."""
    prop = await client_as_alice.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "111 Update Blvd",
            "city": "Austin",
            "state_province": "TX",
            "postal_code": "78705",
            "country": "US",
            "property_type": "SINGLE_FAMILY",
        },
    )
    assert prop.status_code == 201
    property_id = prop.json()["property_id"]
    create = await client_as_alice.post(
        f"{api_base}/listings",
        json={"property_id": property_id, "list_price": 300000},
    )
    assert create.status_code == 201
    listing_id = create.json()["listing_id"]
    response = await client_as_alice.patch(
        f"{api_base}/listings/{listing_id}",
        json={"description": "Updated description", "list_price": 410000},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["listing_id"] == listing_id
    assert data["description"] == "Updated description"
    assert float(data["list_price"]) == 410000
    assert data.get("address_line_1") == "111 Update Blvd"
    assert data.get("city") == "Austin"


@pytest.mark.asyncio
async def test_patch_listing_description_only(client_as_alice: AsyncClient, api_base: str) -> None:
    """PATCH /listings/{id} with only description updates description and leaves list_price unchanged."""
    prop = await client_as_alice.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "789 Desc Only St",
            "city": "Austin",
            "state_province": "TX",
            "postal_code": "78708",
            "country": "US",
            "property_type": "SINGLE_FAMILY",
        },
    )
    assert prop.status_code == 201
    property_id = prop.json()["property_id"]
    create = await client_as_alice.post(
        f"{api_base}/listings",
        json={
            "property_id": property_id,
            "list_price": 300000,
            "listing_type": "FOR_SALE",
            "description": "Original description",
        },
    )
    assert create.status_code == 201
    listing_id = create.json()["listing_id"]
    response = await client_as_alice.patch(
        f"{api_base}/listings/{listing_id}",
        json={"description": "Edited description only"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["listing_id"] == listing_id
    assert data["description"] == "Edited description only"
    assert float(data["list_price"]) == 300000


@pytest.mark.asyncio
async def test_patch_listing_next_open_house_at(client_as_alice: AsyncClient, api_base: str) -> None:
    """PATCH /listings/{id} with next_open_house_at (Phase B.3); GET returns it in overview."""
    prop = await client_as_alice.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "100 Open House Dr",
            "city": "Austin",
            "state_province": "TX",
            "postal_code": "78709",
            "country": "US",
            "property_type": "SINGLE_FAMILY",
        },
    )
    assert prop.status_code == 201
    property_id = prop.json()["property_id"]
    create = await client_as_alice.post(
        f"{api_base}/listings",
        json={"property_id": property_id, "list_price": 425000, "listing_type": "FOR_SALE"},
    )
    assert create.status_code == 201
    listing_id = create.json()["listing_id"]
    open_house_iso = "2025-03-15T18:00:00+00:00"
    response = await client_as_alice.patch(
        f"{api_base}/listings/{listing_id}",
        json={"next_open_house_at": open_house_iso},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["listing_id"] == listing_id
    assert data.get("next_open_house_at") is not None
    assert "2025-03-15" in data["next_open_house_at"] and "18" in data["next_open_house_at"]
    get_resp = await client_as_alice.get(f"{api_base}/listings/{listing_id}")
    assert get_resp.status_code == 200
    assert get_resp.json().get("next_open_house_at") is not None


@pytest.mark.asyncio
async def test_update_listing_not_found(client: AsyncClient, api_base: str) -> None:
    """PATCH /listings/{id} returns 404 for unknown id."""
    response = await client.patch(
        f"{api_base}/listings/{NONEXISTENT_UUID}",
        json={"description": "N/A"},
    )
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_patch_listing_unpublish(client_as_alice: AsyncClient, api_base: str) -> None:
    """PATCH /listings/{id} with status=DRAFT and is_public=false (unpublish) returns 200 and updated listing."""
    prop = await client_as_alice.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "456 Unpublish Ave",
            "city": "Austin",
            "state_province": "TX",
            "postal_code": "78707",
            "country": "US",
            "property_type": "SINGLE_FAMILY",
        },
    )
    assert prop.status_code == 201
    property_id = prop.json()["property_id"]
    create = await client_as_alice.post(
        f"{api_base}/listings",
        json={
            "property_id": property_id,
            "list_price": 250000,
            "listing_type": "FOR_SALE",
            "is_public": True,
        },
    )
    assert create.status_code == 201
    listing_id = create.json()["listing_id"]
    get_before = await client_as_alice.get(f"{api_base}/listings/{listing_id}")
    assert get_before.status_code == 200
    assert get_before.json().get("status") == "DRAFT"
    response = await client_as_alice.patch(
        f"{api_base}/listings/{listing_id}",
        json={"status": "ACTIVE", "is_public": True},
    )
    assert response.status_code == 200
    assert response.json().get("status") == "ACTIVE"
    unpublish = await client_as_alice.patch(
        f"{api_base}/listings/{listing_id}",
        json={"status": "DRAFT", "is_public": False},
    )
    assert unpublish.status_code == 200
    data = unpublish.json()
    assert data["status"] == "DRAFT"
    assert data["is_public"] is False
    assert data.get("address_line_1") == "456 Unpublish Ave"


# ----- Interested buyers (agent view) -----
MATCH_1 = "m0000001-0000-0000-0000-000000000001"
MATCH_2 = "m0000001-0000-0000-0000-000000000002"
BOB_BUYER = "b0000001-0000-0000-0000-000000000002"
PREF_1 = "f0000001-0000-0000-0000-000000000001"


@pytest.mark.asyncio
async def test_list_interested_buyers_ok(client: AsyncClient, api_base: str) -> None:
    """GET /listings/{id}/interested-buyers returns 200 and list (seed has matches when seeded)."""
    response = await client.get(f"{api_base}/listings/{LISTING_1}/interested-buyers")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 0
    for item in data:
        assert "user_id" in item
        assert "preference_id" in item
        assert "match_score" in item
        assert "match_id" in item
        assert float(item["match_score"]) >= 0


@pytest.mark.asyncio
async def test_list_interested_buyers_listing2(client: AsyncClient, api_base: str) -> None:
    """GET /listings/{id}/interested-buyers for listing 2 returns 200 and list."""
    response = await client.get(f"{api_base}/listings/{LISTING_2}/interested-buyers")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_list_interested_buyers_not_found(client: AsyncClient, api_base: str) -> None:
    """GET /listings/{id}/interested-buyers returns 404 for unknown listing."""
    response = await client.get(f"{api_base}/listings/{NONEXISTENT_UUID}/interested-buyers")
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_list_interested_buyers_empty(
    client: AsyncClient, client_as_alice: AsyncClient, api_base: str
) -> None:
    """GET /listings/{id}/interested-buyers returns 200 and empty list for new listing."""
    # Create property and listing as Alice (SELLER_AGENT) so RLS INSERT policy allows (listing_agent = caller).
    prop = await client_as_alice.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "777 New Ln",
            "city": "Austin",
            "state_province": "TX",
            "postal_code": "78706",
            "country": "US",
            "property_type": "SINGLE_FAMILY",
        },
    )
    assert prop.status_code == 201
    property_id = prop.json()["property_id"]
    create = await client_as_alice.post(
        f"{api_base}/listings",
        json={"property_id": property_id, "list_price": 350000},
    )
    assert create.status_code == 201
    listing_id = create.json()["listing_id"]
    response = await client_as_alice.get(f"{api_base}/listings/{listing_id}/interested-buyers")
    assert response.status_code == 200
    assert response.json() == []
