"""Pydantic schemas for property and listing API."""
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


# ----- Property (read) -----
class PropertyOverview(BaseModel):
    """Property overview for list/detail."""

    model_config = ConfigDict(from_attributes=True)

    property_id: UUID
    status: str
    address_line_1: str
    address_line_2: str | None = None
    city: str
    state_province: str
    postal_code: str
    country: str
    latitude: Decimal | None = None
    longitude: Decimal | None = None
    property_type: str
    year_built: int | None = None
    living_area_sqft: int | None = None
    bedrooms: int | None = None
    bathrooms_full: int | None = None
    created_at: datetime
    updated_at: datetime
    cover_image_url: str | None = None  # presigned URL for primary/first image (cards)


class PropertyCreate(BaseModel):
    """Create property (agents)."""

    address_line_1: str = Field(..., min_length=1)
    address_line_2: str | None = None
    city: str = Field(..., min_length=1)
    state_province: str = Field(..., min_length=1)
    postal_code: str = Field(..., min_length=1)
    country: str = "US"
    latitude: Decimal | None = None
    longitude: Decimal | None = None
    property_type: str = Field(..., min_length=1)
    year_built: int | None = None
    living_area_sqft: int | None = None
    bedrooms: int | None = None
    bathrooms_full: int | None = None
    data_source: str = "MANUAL"


class PropertyUpdate(BaseModel):
    """Partial update for property."""

    status: str | None = None
    address_line_2: str | None = None
    year_built: int | None = None
    living_area_sqft: int | None = None
    bedrooms: int | None = None
    bathrooms_full: int | None = None


# ----- Property search (POST body per 09-views-and-apis) -----
class PropertySearchLocation(BaseModel):
    city: str | None = None
    state: str | None = None
    radius_miles: float | None = None


class PropertySearchFilters(BaseModel):
    price_min: Decimal | None = None
    price_max: Decimal | None = None
    bedrooms_min: int | None = None
    property_types: list[str] | None = None


class PropertySearchSort(BaseModel):
    field: str = "list_price"
    direction: str = "asc"


class PropertySearchPagination(BaseModel):
    cursor: str | None = None
    limit: int = 20


class PropertySearchRequest(BaseModel):
    location: PropertySearchLocation | None = None
    filters: PropertySearchFilters | None = None
    sort: PropertySearchSort | None = None
    pagination: PropertySearchPagination | None = None


class PropertySearchResultItem(BaseModel):
    """Single item in PropertySearchResults (listing + property summary)."""
    model_config = ConfigDict(from_attributes=True)
    listing_id: UUID
    property_id: UUID
    address_line_1: str
    city: str
    state_province: str
    postal_code: str
    list_price: Decimal
    price_per_sqft: Decimal | None = None
    bedrooms: int | None = None
    bathrooms_full: int | None = None
    living_area_sqft: int | None = None
    property_type: str
    year_built: int | None = None
    days_on_market: int = 0
    listing_status: str
    primary_image_url: str | None = None
    image_count: int = 0
    distance_miles: float | None = None


class PropertySearchResponse(BaseModel):
    data: list[PropertySearchResultItem]
    meta: dict = Field(default_factory=lambda: {"limit": 20, "cursor": None})


# ----- Property image -----
class PropertyImageOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    image_id: UUID
    property_id: UUID
    storage_path: str
    thumbnail_path: str | None
    is_primary: bool
    display_order: int
    caption: str | None
    moderation_status: str
    view_url: str | None = None  # presigned GET URL for browser display (only when upload completed)


class PropertyImageUploadUrlRequest(BaseModel):
    """Optional filename/content_type for presigned URL."""
    filename: str | None = None
    content_type: str | None = None


class PropertyImageUploadUrlResponse(BaseModel):
    """Presigned PUT URL (MinIO/S3 or stub). Upload file, then PATCH image with file_size_bytes and checksum to confirm."""
    upload_url: str
    image_id: UUID
    storage_path: str
    storage_bucket: str
    expires_in_seconds: int = 3600


class PropertyImageUpdate(BaseModel):
    caption: str | None = None
    display_order: int | None = None
    is_primary: bool | None = None
    file_size_bytes: int | None = None
    checksum: str | None = None


# ----- Listing (read) -----
class ListingOverview(BaseModel):
    """Listing overview for list/detail (includes property location from join)."""

    model_config = ConfigDict(from_attributes=True)

    listing_id: UUID
    property_id: UUID
    status: str
    list_price: Decimal
    price_currency: str
    listing_type: str
    days_on_market: int
    description: str | None = None
    is_public: bool
    created_at: datetime
    updated_at: datetime
    next_open_house_at: datetime | None = None
    cover_image_url: str | None = None  # presigned URL for property primary image (cards)
    # Property location (from v_listing_overviews_v1 join with properties)
    address_line_1: str = ""
    address_line_2: str | None = None
    city: str = ""
    state_province: str = ""
    postal_code: str = ""
    country: str = "US"
    # Geo coordinates (from view join)
    latitude: Decimal | None = None
    longitude: Decimal | None = None


class ListingCreate(BaseModel):
    """Create listing for a property."""

    property_id: UUID
    list_price: Decimal = Field(..., gt=0)
    price_currency: str = "USD"
    listing_type: str = "FOR_SALE"
    description: str | None = None
    listing_agent_id: UUID | None = None
    listing_broker_id: UUID | None = None
    is_public: bool = False


class ListingUpdate(BaseModel):
    """Partial update for listing."""

    status: str | None = None
    list_price: Decimal | None = Field(None, gt=0)
    description: str | None = None
    is_public: bool | None = None
    next_open_house_at: datetime | None = None


class ListingListResponse(BaseModel):
    """Paginated listings."""

    data: list[ListingOverview]
    meta: dict = Field(default_factory=lambda: {"limit": 20, "cursor": None})


# ----- Map search (POST /listings/map-search) -----
class MapBounds(BaseModel):
    """Southwest and northeast corners of the visible map viewport."""
    sw_lat: float = Field(..., ge=-90, le=90)
    sw_lng: float = Field(..., ge=-180, le=180)
    ne_lat: float = Field(..., ge=-90, le=90)
    ne_lng: float = Field(..., ge=-180, le=180)


class MapSearchFilters(BaseModel):
    """Optional filters applied alongside bounding box."""
    status_filter: str | None = None
    price_min: Decimal | None = None
    price_max: Decimal | None = None
    bedrooms_min: int | None = None
    property_types: list[str] | None = None
    search: str | None = None


class MapSearchRequest(BaseModel):
    """Bounding-box search request for map display."""
    bounds: MapBounds
    zoom: int = Field(12, ge=1, le=22)
    filters: MapSearchFilters | None = None
    limit: int = Field(500, ge=1, le=2000)


class MapSearchResponse(BaseModel):
    """GeoJSON FeatureCollection response for map display."""
    type: str = "FeatureCollection"
    features: list[dict]
    meta: dict = Field(default_factory=lambda: {"total_in_bounds": 0, "clustered": False, "zoom": 12})
