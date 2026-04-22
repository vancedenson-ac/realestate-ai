"""Listing endpoints: list, get, create, update, interested-buyers, map-search (09-views-and-apis)."""
from decimal import Decimal
from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from realtrust_api.api.deps import get_db_with_rls
from realtrust_api.api.deps import get_current_user_id
from realtrust_api.core.exceptions import not_found_exception
from realtrust_api.domain.properties import models as m
from realtrust_api.domain.properties import schemas as s
from realtrust_api.domain.matching import models as match_m
from realtrust_api.domain.matching import schemas as match_s

router = APIRouter()


def _grid_size_for_zoom(zoom: int) -> float:
    """Map zoom level to ST_SnapToGrid cell size (degrees)."""
    grid_map = {
        1: 20.0, 2: 15.0, 3: 10.0, 4: 5.0, 5: 2.0,
        6: 1.0, 7: 0.5, 8: 0.2, 9: 0.1, 10: 0.05, 11: 0.02,
    }
    return grid_map.get(zoom, 0.01)


def _format_price_short(price: Decimal | float | None) -> str:
    """Format price for map marker pill: $550K, $1.2M, etc."""
    if price is None:
        return "$0"
    p = float(price)
    if p >= 1_000_000:
        m = p / 1_000_000
        return f"${m:.0f}M" if m % 1 == 0 else f"${m:.1f}M"
    if p >= 1_000:
        k = p / 1_000
        return f"${k:.0f}K"
    return f"${p:.0f}"


@router.get("", response_model=s.ListingListResponse)
async def list_listings(
    limit: int = 20,
    cursor: UUID | None = None,
    status_filter: str | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.ListingListResponse:
    """List listings (query layer: DB view; RLS is final authority). Optional search filters by address, city, state, postal code (ILIKE)."""
    limit_capped = min(limit, 100)
    clauses: list[str] = []
    params: dict[str, object] = {"limit": limit_capped}
    if cursor:
        clauses.append("listing_id < CAST(:cursor AS uuid)")
        params["cursor"] = str(cursor)
    if status_filter:
        clauses.append("status = :status_filter")
        params["status_filter"] = status_filter
    if search and search.strip():
        clauses.append(
            "(address_line_1 ILIKE :search_pattern OR address_line_2 ILIKE :search_pattern OR city ILIKE :search_pattern OR state_province ILIKE :search_pattern OR postal_code ILIKE :search_pattern)"
        )
        params["search_pattern"] = f"%{search.strip()}%"
    where_sql = f"WHERE {' AND '.join(clauses)} " if clauses else ""
    q = text(
        "SELECT * FROM v_listing_overviews_v1 "
        f"{where_sql}"
        "ORDER BY created_at DESC "
        "LIMIT :limit"
    )
    result = await db.execute(q, params)
    rows = result.mappings().all()
    property_ids = [r["property_id"] for r in rows]
    from realtrust_api.api.v1.endpoints.properties import _cover_image_urls_for_properties
    cover_urls = await _cover_image_urls_for_properties(db, property_ids)
    data = [
        s.ListingOverview.model_validate(dict(r)).model_copy(
            update={"cover_image_url": cover_urls.get(r["property_id"])}
        )
        for r in rows
    ]
    next_cursor = rows[-1]["listing_id"] if len(rows) == limit_capped else None
    return s.ListingListResponse(
        data=data,
        meta={"limit": limit_capped, "cursor": str(next_cursor) if next_cursor else None},
    )


@router.post("/map-search", response_model=s.MapSearchResponse)
async def map_search_listings(
    body: s.MapSearchRequest,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.MapSearchResponse:
    """
    Bounding-box search for map display. Returns GeoJSON FeatureCollection.
    - zoom >= 12: return individual listings as GeoJSON Features
    - zoom < 12: return server-side clusters via ST_SnapToGrid
    RLS via get_db_with_rls.
    """
    bounds = body.bounds
    filters = body.filters or s.MapSearchFilters()
    limit = min(body.limit, 2000)
    status_val = filters.status_filter or "ACTIVE"

    # Build filter clauses
    filter_clauses = ["l.status = :status", "p.latitude IS NOT NULL", "p.longitude IS NOT NULL"]
    params: dict[str, object] = {
        "sw_lng": bounds.sw_lng,
        "sw_lat": bounds.sw_lat,
        "ne_lng": bounds.ne_lng,
        "ne_lat": bounds.ne_lat,
        "status": status_val,
        "limit": limit,
    }
    if filters.price_min is not None:
        filter_clauses.append("l.list_price >= :price_min")
        params["price_min"] = float(filters.price_min)
    if filters.price_max is not None:
        filter_clauses.append("l.list_price <= :price_max")
        params["price_max"] = float(filters.price_max)
    if filters.bedrooms_min is not None:
        filter_clauses.append("p.bedrooms >= :bedrooms_min")
        params["bedrooms_min"] = filters.bedrooms_min
    if filters.property_types:
        filter_clauses.append("p.property_type = ANY(:property_types)")
        params["property_types"] = filters.property_types
    if filters.search and filters.search.strip():
        filter_clauses.append(
            "(p.address_line_1 ILIKE :search_pattern OR p.address_line_2 ILIKE :search_pattern OR p.city ILIKE :search_pattern OR p.state_province ILIKE :search_pattern OR p.postal_code ILIKE :search_pattern)"
        )
        params["search_pattern"] = f"%{filters.search.strip()}%"

    # Bounding-box filter via ST_Intersects on the GIST-indexed geography column
    bbox_clause = (
        "ST_Intersects("
        "  p.location,"
        "  ST_MakeEnvelope(:sw_lng, :sw_lat, :ne_lng, :ne_lat, 4326)::geography"
        ")"
    )
    filter_clauses.append(bbox_clause)
    where_sql = " AND ".join(filter_clauses)

    if body.zoom >= 12:
        # Individual listing features
        q = text(f"""
            SELECT
                l.listing_id,
                l.property_id,
                l.list_price,
                l.listing_type,
                l.description,
                l.status,
                p.latitude,
                p.longitude,
                p.address_line_1,
                p.city,
                p.state_province,
                p.postal_code,
                p.bedrooms,
                p.bathrooms_full,
                p.living_area_sqft,
                p.property_type,
                GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - l.created_at)) / 86400))::int AS days_on_market
            FROM listings l
            JOIN properties p ON p.property_id = l.property_id
            WHERE {where_sql}
            ORDER BY l.list_price DESC
            LIMIT :limit
        """)
        result = await db.execute(q, params)
        rows = result.mappings().all()
        features = []
        for r in rows:
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(r["longitude"]), float(r["latitude"])],
                },
                "properties": {
                    "listing_id": str(r["listing_id"]),
                    "property_id": str(r["property_id"]),
                    "list_price": float(r["list_price"]),
                    "price_short": _format_price_short(r["list_price"]),
                    "listing_type": r["listing_type"],
                    "description": r["description"],
                    "status": r["status"],
                    "address_line_1": r["address_line_1"],
                    "city": r["city"],
                    "state_province": r["state_province"],
                    "postal_code": r["postal_code"],
                    "bedrooms": r["bedrooms"],
                    "bathrooms_full": r["bathrooms_full"],
                    "living_area_sqft": r["living_area_sqft"],
                    "property_type": r["property_type"],
                    "days_on_market": r["days_on_market"],
                },
            })
        return s.MapSearchResponse(
            type="FeatureCollection",
            features=features,
            meta={"total_in_bounds": len(features), "clustered": False, "zoom": body.zoom},
        )
    else:
        # Server-side clustering via ST_SnapToGrid
        grid_size = _grid_size_for_zoom(body.zoom)
        params["grid_size"] = grid_size
        cluster_q = text(f"""
            SELECT
                ST_X(ST_Centroid(ST_Collect(p.location::geometry))) AS centroid_lng,
                ST_Y(ST_Centroid(ST_Collect(p.location::geometry))) AS centroid_lat,
                COUNT(*) AS point_count,
                AVG(l.list_price) AS avg_price,
                MIN(l.list_price) AS min_price,
                MAX(l.list_price) AS max_price
            FROM listings l
            JOIN properties p ON p.property_id = l.property_id
            WHERE {where_sql}
            GROUP BY ST_SnapToGrid(p.location::geometry, :grid_size)
            LIMIT :limit
        """)
        result = await db.execute(cluster_q, params)
        rows = result.mappings().all()
        features = []
        total_count = 0
        for r in rows:
            count = int(r["point_count"])
            total_count += count
            if count == 1:
                # Single-point cluster → treat as individual
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(r["centroid_lng"]), float(r["centroid_lat"])],
                    },
                    "properties": {
                        "cluster": False,
                        "point_count": 1,
                        "avg_price": float(r["avg_price"]),
                        "price_short": _format_price_short(r["avg_price"]),
                    },
                })
            else:
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(r["centroid_lng"]), float(r["centroid_lat"])],
                    },
                    "properties": {
                        "cluster": True,
                        "point_count": count,
                        "avg_price": float(r["avg_price"]),
                        "min_price": float(r["min_price"]),
                        "max_price": float(r["max_price"]),
                        "price_short": _format_price_short(r["avg_price"]),
                    },
                })
        return s.MapSearchResponse(
            type="FeatureCollection",
            features=features,
            meta={"total_in_bounds": total_count, "clustered": True, "zoom": body.zoom},
        )


@router.get("/{listing_id}", response_model=s.ListingOverview)
async def get_listing(
    listing_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.ListingOverview:
    """Get listing by id (query layer: DB view; RLS-filtered)."""
    result = await db.execute(
        text("SELECT * FROM v_listing_overviews_v1 WHERE listing_id = CAST(:lid AS uuid)"),
        {"lid": str(listing_id)},
    )
    row = result.mappings().first()
    if not row:
        raise not_found_exception("Listing", str(listing_id))
    from realtrust_api.api.v1.endpoints.properties import _cover_image_urls_for_properties
    cover_urls = await _cover_image_urls_for_properties(db, [row["property_id"]])
    return s.ListingOverview.model_validate(dict(row)).model_copy(
        update={"cover_image_url": cover_urls.get(row["property_id"])}
    )


@router.post("", response_model=s.ListingOverview, status_code=status.HTTP_201_CREATED)
async def create_listing(
    body: s.ListingCreate,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.ListingOverview:
    """Create listing for a property (triggers embedding generation when workers are added)."""
    # RLS insert policy requires either listing_agent_id = caller or listing_broker_id = caller org.
    # Default to caller as listing_agent_id when omitted (matches dev/test workflows).
    listing_agent_id = body.listing_agent_id
    listing_broker_id = body.listing_broker_id
    if listing_agent_id is None and listing_broker_id is None:
        listing_agent_id = current_user_id
    listing = m.Listing(
        property_id=body.property_id,
        list_price=body.list_price,
        price_currency=body.price_currency,
        listing_type=body.listing_type,
        description=body.description,
        listing_agent_id=listing_agent_id,
        listing_broker_id=listing_broker_id,
        is_public=body.is_public,
    )
    db.add(listing)
    await db.flush()
    # Refetch from view so response includes property address fields
    result = await db.execute(
        text("SELECT * FROM v_listing_overviews_v1 WHERE listing_id = CAST(:lid AS uuid)"),
        {"lid": str(listing.listing_id)},
    )
    row = result.mappings().first()
    if not row:
        raise not_found_exception("Listing", str(listing.listing_id))
    from realtrust_api.api.v1.endpoints.properties import _cover_image_urls_for_properties
    cover_urls = await _cover_image_urls_for_properties(db, [listing.property_id])
    return s.ListingOverview.model_validate(dict(row)).model_copy(
        update={"cover_image_url": cover_urls.get(listing.property_id)}
    )


@router.patch("/{listing_id}", response_model=s.ListingOverview)
async def update_listing(
    listing_id: UUID,
    body: s.ListingUpdate,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.ListingOverview:
    """Update listing (price, description, status)."""
    result = await db.execute(select(m.Listing).where(m.Listing.listing_id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise not_found_exception("Listing", str(listing_id))
    update_data = body.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(listing, k, v)
    await db.flush()
    # Refetch from view so response includes property address fields
    result = await db.execute(
        text("SELECT * FROM v_listing_overviews_v1 WHERE listing_id = CAST(:lid AS uuid)"),
        {"lid": str(listing_id)},
    )
    row = result.mappings().first()
    if not row:
        raise not_found_exception("Listing", str(listing_id))
    from realtrust_api.api.v1.endpoints.properties import _cover_image_urls_for_properties
    cover_urls = await _cover_image_urls_for_properties(db, [listing.property_id])
    return s.ListingOverview.model_validate(dict(row)).model_copy(
        update={"cover_image_url": cover_urls.get(listing.property_id)}
    )


@router.get("/{listing_id}/interested-buyers", response_model=list[match_s.InterestedBuyerItem])
async def list_interested_buyers(
    listing_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[match_s.InterestedBuyerItem]:
    """Agent view: buyers whose preferences match this listing (property_matches for this listing_id)."""
    result = await db.execute(select(m.Listing).where(m.Listing.listing_id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise not_found_exception("Listing", str(listing_id))
    q = (
        select(match_m.PropertyMatch)
        .where(match_m.PropertyMatch.listing_id == listing_id)
        .order_by(match_m.PropertyMatch.match_score.desc())
    )
    result = await db.execute(q)
    rows = result.scalars().all()
    return [
        match_s.InterestedBuyerItem(
            user_id=row.user_id,
            preference_id=row.preference_id,
            match_score=row.match_score,
            match_id=row.match_id,
        )
        for row in rows
    ]
