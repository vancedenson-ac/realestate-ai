"""Pydantic schemas for buyer preferences and property matching (09-views-and-apis)."""
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


# ----- Buyer preference -----
class PreferenceOverview(BaseModel):
    """Preference overview for list/detail."""

    model_config = ConfigDict(from_attributes=True)

    preference_id: UUID
    user_id: UUID
    is_active: bool
    price_min: Decimal | None = None
    price_max: Decimal | None = None
    bedrooms_min: int | None = None
    preferred_states: list[str] | None = None
    preferred_cities: list[str] | None = None
    notification_frequency: str
    created_at: datetime
    updated_at: datetime


class PreferenceCreate(BaseModel):
    """Create buyer preference."""

    price_min: Decimal | None = None
    price_max: Decimal | None = None
    bedrooms_min: int | None = None
    bedrooms_max: int | None = None
    preferred_states: list[str] | None = None
    preferred_cities: list[str] | None = None
    preferred_zip_codes: list[str] | None = None
    property_types: list[str] | None = None
    min_sqft: int | None = None
    max_sqft: int | None = None
    lifestyle_description: str | None = None
    notification_frequency: str = "DAILY"


class PreferenceUpdate(BaseModel):
    """Partial update for preference."""

    is_active: bool | None = None
    price_min: Decimal | None = None
    price_max: Decimal | None = None
    bedrooms_min: int | None = None
    preferred_states: list[str] | None = None
    preferred_cities: list[str] | None = None
    notification_frequency: str | None = None


# ----- Recommendation (PropertyRecommendation per 09) -----
class ListingDetailsShort(BaseModel):
    """Minimal listing for recommendation item."""

    listing_id: UUID
    list_price: Decimal
    status: str
    days_on_market: int


class PropertyDetailsShort(BaseModel):
    """Minimal property for recommendation item."""

    property_id: UUID
    address_line_1: str
    city: str
    state_province: str
    postal_code: str
    bedrooms: int | None = None
    bathrooms_full: int | None = None
    living_area_sqft: int | None = None
    property_type: str


class RecommendationItem(BaseModel):
    """Single recommendation (listing + property + match score)."""

    match_id: UUID
    listing: ListingDetailsShort
    property: PropertyDetailsShort
    match_score: Decimal = Field(..., ge=0, le=1)
    match_explanation: str | None = None
    score_breakdown: dict
    recommended_at: datetime


class RecommendationsResponse(BaseModel):
    """Paginated recommendations."""

    recommendations: list[RecommendationItem]
    meta: dict = Field(default_factory=lambda: {"limit": 20, "cursor": None})


# ----- Feedback -----
class FeedbackBody(BaseModel):
    """User feedback on a recommendation."""

    feedback: str = Field(..., pattern="^(LIKED|DISLIKED|SAVED|CONTACTED)$")


# ----- Interested buyers (agent view) -----
class InterestedBuyerItem(BaseModel):
    """Buyer who matches this listing (for agent view)."""

    user_id: UUID
    preference_id: UUID
    match_score: Decimal
    match_id: UUID


# ----- Saved listings (user bookmarks) -----
class SavedListingCreate(BaseModel):
    """Save a listing for the current user."""

    listing_id: UUID


class SavedListingOverview(BaseModel):
    """Saved listing with minimal listing + property info for list view."""

    listing_id: UUID
    property_id: UUID
    address_line_1: str
    city: str
    state_province: str
    postal_code: str
    list_price: Decimal
    listing_status: str
    saved_at: datetime
