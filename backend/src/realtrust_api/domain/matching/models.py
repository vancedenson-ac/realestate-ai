"""SQLAlchemy models for buyer_preferences and property_matches (02-schema.sql)."""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from realtrust_api.domain.shared.base import Base


class BuyerPreference(Base):
    __tablename__ = "buyer_preferences"

    preference_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    preferred_cities: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    preferred_states: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    preferred_zip_codes: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    max_commute_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    commute_destination_lat: Mapped[Decimal | None] = mapped_column(Numeric(10, 8), nullable=True)
    commute_destination_lng: Mapped[Decimal | None] = mapped_column(Numeric(11, 8), nullable=True)
    price_min: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    price_max: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    bedrooms_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bedrooms_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bathrooms_min: Mapped[Decimal | None] = mapped_column(Numeric(3, 1), nullable=True)
    property_types: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    min_sqft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_sqft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_lot_sqft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    year_built_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    must_have_pool: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    must_have_garage: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    must_have_yard: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    must_have_view: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    nice_to_have: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    lifestyle_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    preference_embedding_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    notification_frequency: Mapped[str] = mapped_column(
        String, nullable=False, server_default="DAILY"
    )

    matches: Mapped[list["PropertyMatch"]] = relationship(
        "PropertyMatch", back_populates="preference", cascade="all, delete-orphan"
    )


class PropertyMatch(Base):
    __tablename__ = "property_matches"

    match_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=False
    )
    preference_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("buyer_preferences.preference_id"), nullable=False
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.listing_id"), nullable=False
    )
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    match_score: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False)
    score_breakdown: Mapped[dict] = mapped_column(JSONB, nullable=False)
    ai_explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    feedback_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_notified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    preference: Mapped["BuyerPreference"] = relationship("BuyerPreference", back_populates="matches")
    # Listing/Property loaded via join in API; avoid circular import by not importing properties here


class SavedListing(Base):
    __tablename__ = "saved_listings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=False, primary_key=True
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.listing_id"), nullable=False, primary_key=True
    )
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
