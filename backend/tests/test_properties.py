"""Property endpoints: list, get, create, update."""
import pytest
from httpx import AsyncClient

from tests.conftest import error_code

# Seed UUIDs (from 03-seed.sql)
PROP_OAK = "d0000001-0000-0000-0000-000000000001"
PROP_ELM = "d0000001-0000-0000-0000-000000000002"
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"
ORG_ACME = "a0000001-0000-0000-0000-000000000001"


@pytest.mark.asyncio
async def test_list_properties(client: AsyncClient, api_base: str) -> None:
    """GET /properties returns 200 and list of properties."""
    response = await client.get(f"{api_base}/properties")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_list_properties_with_params(client: AsyncClient, api_base: str) -> None:
    """GET /properties?limit=1&offset=0&status_filter=ACTIVE returns 200."""
    response = await client.get(
        f"{api_base}/properties",
        params={"limit": 1, "offset": 0, "status_filter": "ACTIVE"},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    for p in data:
        assert p.get("status") == "ACTIVE"


@pytest.mark.asyncio
async def test_get_property_ok(client: AsyncClient, api_base: str) -> None:
    """GET /properties/{id} returns 200 for existing property."""
    create = await client.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "123 Get St",
            "city": "Austin",
            "state_province": "TX",
            "postal_code": "78701",
            "country": "US",
            "property_type": "SINGLE_FAMILY",
        },
    )
    assert create.status_code == 201
    property_id = create.json()["property_id"]
    response = await client.get(f"{api_base}/properties/{property_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["property_id"] == property_id
    assert data["address_line_1"] == "123 Get St"
    assert data["property_type"] == "SINGLE_FAMILY"


@pytest.mark.asyncio
async def test_get_property_not_found(client: AsyncClient, api_base: str) -> None:
    """GET /properties/{id} returns 404 for unknown id."""
    response = await client.get(f"{api_base}/properties/{NONEXISTENT_UUID}")
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_create_property_ok(client: AsyncClient, api_base: str) -> None:
    """POST /properties returns 201 and creates property."""
    response = await client.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "789 Test St",
            "city": "Austin",
            "state_province": "TX",
            "postal_code": "78703",
            "country": "US",
            "property_type": "SINGLE_FAMILY",
            "bedrooms": 3,
            "bathrooms_full": 2,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["address_line_1"] == "789 Test St"
    assert data["city"] == "Austin"
    assert data["property_type"] == "SINGLE_FAMILY"
    assert "property_id" in data


@pytest.mark.asyncio
async def test_create_property_validation_fails(client: AsyncClient, api_base: str) -> None:
    """POST /properties with missing required fields returns 422."""
    response = await client.post(
        f"{api_base}/properties",
        json={"city": "Austin"},  # missing address_line_1, state_province, postal_code, property_type
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_property_with_all_optional_fields(client: AsyncClient, api_base: str) -> None:
    """POST /properties with full new-property UI payload (address, type, beds, baths, sqft, year) returns 201."""
    response = await client.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "100 Full Form St",
            "address_line_2": "Suite 2",
            "city": "Seattle",
            "state_province": "WA",
            "postal_code": "98101",
            "country": "US",
            "property_type": "CONDO",
            "year_built": 2020,
            "living_area_sqft": 1200,
            "bedrooms": 2,
            "bathrooms_full": 2,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["address_line_1"] == "100 Full Form St"
    assert data["address_line_2"] == "Suite 2"
    assert data["city"] == "Seattle"
    assert data["state_province"] == "WA"
    assert data["postal_code"] == "98101"
    assert data["country"] == "US"
    assert data["property_type"] == "CONDO"
    assert data["year_built"] == 2020
    assert data["living_area_sqft"] == 1200
    assert data["bedrooms"] == 2
    assert data["bathrooms_full"] == 2
    assert "property_id" in data


@pytest.mark.asyncio
async def test_update_property_ok(client: AsyncClient, api_base: str) -> None:
    """PATCH /properties/{id} returns 200 and updates fields."""
    create = await client.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "456 Update Ave",
            "city": "Austin",
            "state_province": "TX",
            "postal_code": "78702",
            "country": "US",
            "property_type": "TOWNHOUSE",
            "bedrooms": 3,
        },
    )
    assert create.status_code == 201
    property_id = create.json()["property_id"]
    response = await client.patch(
        f"{api_base}/properties/{property_id}",
        json={"bedrooms": 4, "living_area_sqft": 1900},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["property_id"] == property_id
    assert data["bedrooms"] == 4
    assert data["living_area_sqft"] == 1900


@pytest.mark.asyncio
async def test_update_property_not_found(client: AsyncClient, api_base: str) -> None:
    """PATCH /properties/{id} returns 404 for unknown id."""
    response = await client.patch(
        f"{api_base}/properties/{NONEXISTENT_UUID}",
        json={"bedrooms": 5},
    )
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"
