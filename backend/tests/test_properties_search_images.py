"""Property search (POST /search), property images, and search-by-image stub."""
import pytest
from httpx import AsyncClient

from tests.conftest import error_code

# Seed UUIDs (03-seed.sql) — Maricopa County, AZ properties
PROP_OAK = "d0000001-0000-0000-0000-000000000001"  # Scottsdale Old Town condo
PROP_ELM = "d0000001-0000-0000-0000-000000000002"  # Scottsdale McCormick Ranch
LISTING_1 = "e0000001-0000-0000-0000-000000000001"
LISTING_2 = "e0000001-0000-0000-0000-000000000002"
IMAGE_1 = "91000001-0000-0000-0000-000000000001"  # seed image (hex-only UUID)
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"
API_V1 = "/realtrust-ai/v1"


@pytest.mark.asyncio
async def test_search_properties_empty_body(client: AsyncClient, api_base: str) -> None:
    """POST /properties/search with empty body returns 200 and list (default filters)."""
    response = await client.post(f"{api_base}/properties/search", json={})
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert "meta" in data
    assert "limit" in data["meta"]
    assert isinstance(data["data"], list)


@pytest.mark.asyncio
async def test_search_properties_with_filters(client: AsyncClient, api_base: str) -> None:
    """POST /properties/search with location and filters returns matching listings."""
    response = await client.post(
        f"{api_base}/properties/search",
        json={
            "location": {"city": "Scottsdale", "state": "AZ"},
            "filters": {"price_min": 400000, "price_max": 800000, "bedrooms_min": 2},
            "pagination": {"limit": 10},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    items = data["data"]
    assert isinstance(items, list)
    for item in items:
        assert "listing_id" in item
        assert "property_id" in item
        assert "list_price" in item
        assert "listing_status" in item
        assert item.get("listing_status") == "ACTIVE"
        assert item.get("city") == "Scottsdale"
        assert item.get("state_province") == "AZ"


@pytest.mark.asyncio
async def test_search_properties_sort_and_pagination(client: AsyncClient, api_base: str) -> None:
    """POST /properties/search with sort and pagination returns correct shape."""
    response = await client.post(
        f"{api_base}/properties/search",
        json={
            "sort": {"field": "list_price", "direction": "asc"},
            "pagination": {"limit": 1},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["data"]) <= 1
    if data["data"]:
        assert "price_per_sqft" in data["data"][0] or data["data"][0].get("price_per_sqft") is None
        assert "image_count" in data["data"][0]
        assert "primary_image_url" in data["data"][0]


@pytest.mark.asyncio
async def test_property_images_upload_url(client: AsyncClient, api_base: str) -> None:
    """POST /properties/{id}/images/upload returns 200 and presigned URL (MinIO or stub) with storage_path/bucket."""
    response = await client.post(f"{api_base}/properties/{PROP_OAK}/images/upload")
    assert response.status_code == 200
    data = response.json()
    assert "upload_url" in data
    assert "image_id" in data
    assert "storage_path" in data
    assert "storage_bucket" in data
    assert data.get("expires_in_seconds") == 3600


@pytest.mark.asyncio
async def test_property_images_upload_not_found(client: AsyncClient, api_base: str) -> None:
    """POST /properties/{id}/images/upload returns 404 for unknown property."""
    response = await client.post(f"{api_base}/properties/{NONEXISTENT_UUID}/images/upload")
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_list_property_images(client: AsyncClient, api_base: str) -> None:
    """GET /properties/{id}/images returns 200 and list (seed has one image for Oak when seeded)."""
    response = await client.get(f"{api_base}/properties/{PROP_OAK}/images")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    for img in data:
        assert "image_id" in img
        assert "property_id" in img
        assert "is_primary" in img
        assert "moderation_status" in img


@pytest.mark.asyncio
async def test_list_property_images_empty(client: AsyncClient, api_base: str) -> None:
    """GET /properties/{id}/images returns 200 and empty list for property with no images (after create)."""
    create = await client.post(
        f"{api_base}/properties",
        json={
            "address_line_1": "999 NoImg St",
            "city": "Austin",
            "state_province": "TX",
            "postal_code": "78799",
            "country": "US",
            "property_type": "SINGLE_FAMILY",
        },
    )
    assert create.status_code == 201
    property_id = create.json()["property_id"]
    response = await client.get(f"{api_base}/properties/{property_id}/images")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_update_property_image(client: AsyncClient, api_base: str) -> None:
    """PATCH /properties/{id}/images/{image_id} updates caption, order, and optional file_size/checksum (confirm upload)."""
    upload = await client.post(f"{api_base}/properties/{PROP_OAK}/images/upload")
    assert upload.status_code == 200
    image_id = upload.json()["image_id"]
    response = await client.patch(
        f"{api_base}/properties/{PROP_OAK}/images/{image_id}",
        json={
            "caption": "Front view",
            "display_order": 1,
            "file_size_bytes": 12345,
            "checksum": "sha256:abc",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["image_id"] == image_id
    assert data["caption"] == "Front view"
    assert data["display_order"] == 1
    # PATCH response includes view_url when upload is complete (presigned URL or null if storage not configured)
    assert "view_url" in data


@pytest.mark.asyncio
async def test_update_property_image_not_found(client: AsyncClient, api_base: str) -> None:
    """PATCH /properties/{id}/images/{image_id} returns 404 for unknown image."""
    response = await client.patch(
        f"{api_base}/properties/{PROP_OAK}/images/{NONEXISTENT_UUID}",
        json={"caption": "x"},
    )
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_delete_property_image(client: AsyncClient, api_base: str) -> None:
    """DELETE /properties/{id}/images/{image_id} returns 204 and removes image."""
    upload = await client.post(f"{api_base}/properties/{PROP_ELM}/images/upload")
    assert upload.status_code == 200
    image_id = upload.json()["image_id"]
    response = await client.delete(f"{api_base}/properties/{PROP_ELM}/images/{image_id}")
    assert response.status_code == 204
    list_resp = await client.get(f"{api_base}/properties/{PROP_ELM}/images")
    assert list_resp.status_code == 200
    ids = [i["image_id"] for i in list_resp.json()]
    assert image_id not in ids


@pytest.mark.asyncio
async def test_delete_property_image_not_found(client: AsyncClient, api_base: str) -> None:
    """DELETE /properties/{id}/images/{image_id} returns 404 for unknown image."""
    response = await client.delete(
        f"{api_base}/properties/{PROP_OAK}/images/{NONEXISTENT_UUID}"
    )
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_search_by_image_stub(client: AsyncClient, api_base: str) -> None:
    """POST /properties/search/by-image returns 200 and empty data (stub)."""
    response = await client.post(f"{api_base}/properties/search/by-image", json={})
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert data["data"] == []
    assert "meta" in data


@pytest.mark.asyncio
async def test_list_property_images_includes_view_url(client: AsyncClient, api_base: str) -> None:
    """GET /properties/{id}/images returns view_url for completed uploads."""
    response = await client.get(f"{api_base}/properties/{PROP_OAK}/images")
    assert response.status_code == 200
    data = response.json()
    for img in data:
        assert "view_url" in img
        # When upload completed (file_size set, checksum not pending), view_url may be set or null if no storage
        if img.get("view_url"):
            assert img["view_url"].startswith("http")


@pytest.mark.asyncio
async def test_list_properties_includes_cover_image_url(client: AsyncClient, api_base: str) -> None:
    """GET /properties returns cover_image_url on each item (presigned URL or null)."""
    response = await client.get(f"{api_base}/properties", params={"limit": 5})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    for p in data:
        assert "cover_image_url" in p


@pytest.mark.asyncio
async def test_get_property_includes_cover_image_url(client: AsyncClient, api_base: str) -> None:
    """GET /properties/{id} returns cover_image_url (presigned URL or null)."""
    response = await client.get(f"{api_base}/properties/{PROP_OAK}")
    assert response.status_code == 200
    data = response.json()
    assert "cover_image_url" in data


@pytest.mark.asyncio
async def test_set_primary_image_cover(client: AsyncClient, api_base: str) -> None:
    """PATCH image with is_primary=true; list images and GET property reflect primary; cover_image_url present when upload done."""
    upload = await client.post(f"{api_base}/properties/{PROP_ELM}/images/upload")
    assert upload.status_code == 200
    image_id = upload.json()["image_id"]
    await client.patch(
        f"{api_base}/properties/{PROP_ELM}/images/{image_id}",
        json={"file_size_bytes": 999, "checksum": "sha256:done", "is_primary": True},
    )
    list_img = await client.get(f"{api_base}/properties/{PROP_ELM}/images")
    assert list_img.status_code == 200
    images = list_img.json()
    primary = [i for i in images if i["is_primary"]]
    assert len(primary) == 1
    assert primary[0]["image_id"] == image_id
    get_prop = await client.get(f"{api_base}/properties/{PROP_ELM}")
    assert get_prop.status_code == 200
    assert "cover_image_url" in get_prop.json()


@pytest.mark.asyncio
async def test_list_listings_includes_cover_image_url(client: AsyncClient, api_base: str) -> None:
    """GET /listings returns cover_image_url on each item."""
    response = await client.get(f"{api_base}/listings", params={"limit": 5})
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    for item in data["data"]:
        assert "cover_image_url" in item
