"""Tests for POST /listings/map-search — bounding-box search for map display."""
import pytest
from httpx import AsyncClient

# Bounding box covering all Maricopa County seed properties (lat ~33.28–33.83, lng ~-112.40–-111.69)
MARICOPA_BOUNDS = {
    "sw_lat": 33.20,
    "sw_lng": -112.50,
    "ne_lat": 33.90,
    "ne_lng": -111.60,
}

# Bounding box in the middle of the Pacific Ocean — no properties
OCEAN_BOUNDS = {
    "sw_lat": 10.0,
    "sw_lng": -160.0,
    "ne_lat": 11.0,
    "ne_lng": -159.0,
}

# Tight bounding box around Old Town Scottsdale (should capture only a few properties)
SCOTTSDALE_DOWNTOWN_BOUNDS = {
    "sw_lat": 33.485,
    "sw_lng": -111.935,
    "ne_lat": 33.500,
    "ne_lng": -111.915,
}


@pytest.mark.asyncio
async def test_map_search_returns_geojson(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /listings/map-search returns valid GeoJSON FeatureCollection with features."""
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={"bounds": MARICOPA_BOUNDS, "zoom": 14},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert isinstance(data["features"], list)
    assert "meta" in data
    assert data["meta"]["clustered"] is False
    assert data["meta"]["zoom"] == 14
    assert data["meta"]["total_in_bounds"] > 0
    # Each feature must be a valid GeoJSON Feature
    for f in data["features"]:
        assert f["type"] == "Feature"
        assert f["geometry"]["type"] == "Point"
        assert len(f["geometry"]["coordinates"]) == 2
        assert "listing_id" in f["properties"]
        assert "list_price" in f["properties"]
        assert "price_short" in f["properties"]
        assert "address_line_1" in f["properties"]


@pytest.mark.asyncio
async def test_map_search_bounds_filter(client_as_alice: AsyncClient, api_base: str) -> None:
    """Only properties within the bounding box are returned."""
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={"bounds": SCOTTSDALE_DOWNTOWN_BOUNDS, "zoom": 15},
    )
    assert response.status_code == 200
    data = response.json()
    # All features must have coordinates within the bounding box
    for f in data["features"]:
        lng, lat = f["geometry"]["coordinates"]
        assert SCOTTSDALE_DOWNTOWN_BOUNDS["sw_lat"] <= lat <= SCOTTSDALE_DOWNTOWN_BOUNDS["ne_lat"]
        assert SCOTTSDALE_DOWNTOWN_BOUNDS["sw_lng"] <= lng <= SCOTTSDALE_DOWNTOWN_BOUNDS["ne_lng"]


@pytest.mark.asyncio
async def test_map_search_out_of_bounds_empty(client_as_alice: AsyncClient, api_base: str) -> None:
    """Bounding box in the ocean returns empty features list."""
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={"bounds": OCEAN_BOUNDS, "zoom": 12},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["features"] == []
    assert data["meta"]["total_in_bounds"] == 0


@pytest.mark.asyncio
async def test_map_search_status_filter(client_as_alice: AsyncClient, api_base: str) -> None:
    """Status filter limits to the requested status."""
    # DRAFT listings should not appear for ACTIVE filter
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={
            "bounds": MARICOPA_BOUNDS,
            "zoom": 14,
            "filters": {"status_filter": "ACTIVE"},
        },
    )
    assert response.status_code == 200
    data = response.json()
    for f in data["features"]:
        assert f["properties"]["status"] == "ACTIVE"


@pytest.mark.asyncio
async def test_map_search_price_filter(client_as_alice: AsyncClient, api_base: str) -> None:
    """Price range filters work correctly."""
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={
            "bounds": MARICOPA_BOUNDS,
            "zoom": 14,
            "filters": {"price_min": 400000, "price_max": 600000},
        },
    )
    assert response.status_code == 200
    data = response.json()
    for f in data["features"]:
        price = f["properties"]["list_price"]
        assert 400000 <= price <= 600000


@pytest.mark.asyncio
async def test_map_search_bedrooms_filter(client_as_alice: AsyncClient, api_base: str) -> None:
    """Bedrooms minimum filter works correctly."""
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={
            "bounds": MARICOPA_BOUNDS,
            "zoom": 14,
            "filters": {"bedrooms_min": 4},
        },
    )
    assert response.status_code == 200
    data = response.json()
    for f in data["features"]:
        assert f["properties"]["bedrooms"] >= 4


@pytest.mark.asyncio
async def test_map_search_rls_applied(
    client_as_bob: AsyncClient, client_as_alice: AsyncClient, api_base: str,
) -> None:
    """RLS is applied — different users may see different results. Buyer must not see DRAFT."""
    # Alice (SELLER_AGENT) searches for DRAFT
    response_alice = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={
            "bounds": MARICOPA_BOUNDS,
            "zoom": 14,
            "filters": {"status_filter": "DRAFT"},
        },
    )
    assert response_alice.status_code == 200
    # Bob (BUYER) searches for DRAFT — should see empty (RLS denies DRAFT for buyers)
    response_bob = await client_as_bob.post(
        f"{api_base}/listings/map-search",
        json={
            "bounds": MARICOPA_BOUNDS,
            "zoom": 14,
            "filters": {"status_filter": "DRAFT"},
        },
    )
    assert response_bob.status_code == 200
    bob_data = response_bob.json()
    assert bob_data["features"] == [], "Buyer must not see DRAFT listings via map search (RLS)"


@pytest.mark.asyncio
async def test_map_search_limit_respected(client_as_alice: AsyncClient, api_base: str) -> None:
    """Response contains at most `limit` features."""
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={"bounds": MARICOPA_BOUNDS, "zoom": 14, "limit": 2},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["features"]) <= 2


@pytest.mark.asyncio
async def test_map_search_cluster_at_low_zoom(client_as_alice: AsyncClient, api_base: str) -> None:
    """At zoom < 12, response uses server-side clustering."""
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={"bounds": MARICOPA_BOUNDS, "zoom": 5},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["meta"]["clustered"] is True
    # Clusters should aggregate — fewer features than individual
    assert data["meta"]["total_in_bounds"] > 0
    for f in data["features"]:
        props = f["properties"]
        assert "point_count" in props
        assert "avg_price" in props


@pytest.mark.asyncio
async def test_map_search_individual_at_high_zoom(client_as_alice: AsyncClient, api_base: str) -> None:
    """At zoom >= 12, response returns individual listing features (not clustered)."""
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={"bounds": MARICOPA_BOUNDS, "zoom": 14},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["meta"]["clustered"] is False
    for f in data["features"]:
        assert "listing_id" in f["properties"]
        assert "cluster" not in f["properties"] or f["properties"]["cluster"] is False


@pytest.mark.asyncio
async def test_listing_overview_includes_lat_lng(client_as_alice: AsyncClient, api_base: str) -> None:
    """Existing /listings endpoint now returns latitude/longitude fields."""
    response = await client_as_alice.get(
        f"{api_base}/listings",
        params={"limit": 5, "status_filter": "ACTIVE"},
    )
    assert response.status_code == 200
    data = response.json()
    # At least one listing should have coordinates (seed data has lat/lng)
    found_with_coords = False
    for item in data["data"]:
        assert "latitude" in item
        assert "longitude" in item
        if item["latitude"] is not None and item["longitude"] is not None:
            found_with_coords = True
    assert found_with_coords, "At least one seed listing should have lat/lng"


@pytest.mark.asyncio
async def test_map_search_search_filter(client_as_alice: AsyncClient, api_base: str) -> None:
    """filters.search limits results to address/city/state/postal (ILIKE)."""
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={
            "bounds": MARICOPA_BOUNDS,
            "zoom": 14,
            "filters": {"search": "Scottsdale"},
        },
    )
    assert response.status_code == 200
    data = response.json()
    for f in data["features"]:
        props = f.get("properties", {})
        city = (props.get("city") or "").lower()
        addr = (props.get("address_line_1") or "").lower()
        assert "scottsdale" in city or "scottsdale" in addr
    # Nonexistent search returns empty
    empty = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={
            "bounds": MARICOPA_BOUNDS,
            "zoom": 14,
            "filters": {"search": "nonexistentcity123xyz"},
        },
    )
    assert empty.status_code == 200
    assert empty.json()["features"] == []
    assert empty.json()["meta"]["total_in_bounds"] == 0


@pytest.mark.asyncio
async def test_map_search_validation_errors(client_as_alice: AsyncClient, api_base: str) -> None:
    """Invalid request body returns 422."""
    # Missing bounds
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={"zoom": 12},
    )
    assert response.status_code == 422

    # Invalid lat (> 90)
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={"bounds": {"sw_lat": 100, "sw_lng": -112, "ne_lat": 34, "ne_lng": -111}, "zoom": 12},
    )
    assert response.status_code == 422

    # Invalid zoom (> 22)
    response = await client_as_alice.post(
        f"{api_base}/listings/map-search",
        json={"bounds": MARICOPA_BOUNDS, "zoom": 25},
    )
    assert response.status_code == 422
