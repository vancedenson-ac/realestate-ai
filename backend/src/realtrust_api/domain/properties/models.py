"""SQLAlchemy models for properties and listings (02-schema.sql)."""
import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from realtrust_api.domain.shared.base import Base


class PropertyImage(Base):
    __tablename__ = "property_images"

    image_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    property_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("properties.property_id"), nullable=False
    )
    listing_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.listing_id"), nullable=True
    )
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=False
    )
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    storage_bucket: Mapped[str] = mapped_column(Text, nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    checksum: Mapped[str] = mapped_column(Text, nullable=False)
    thumbnail_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    medium_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    large_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    webp_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    moderation_status: Mapped[str] = mapped_column(String, nullable=False, server_default="PENDING")


class Property(Base):
    __tablename__ = "properties"

    property_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    status: Mapped[str] = mapped_column(String, nullable=False, server_default="ACTIVE")
    address_line_1: Mapped[str] = mapped_column(Text, nullable=False)
    address_line_2: Mapped[str | None] = mapped_column(Text, nullable=True)
    city: Mapped[str] = mapped_column(Text, nullable=False)
    state_province: Mapped[str] = mapped_column(Text, nullable=False)
    postal_code: Mapped[str] = mapped_column(Text, nullable=False)
    country: Mapped[str] = mapped_column(Text, nullable=False, server_default="US")
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 8), nullable=True)
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(11, 8), nullable=True)
    parcel_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    county: Mapped[str | None] = mapped_column(Text, nullable=True)
    neighborhood: Mapped[str | None] = mapped_column(Text, nullable=True)
    property_type: Mapped[str] = mapped_column(Text, nullable=False)
    year_built: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lot_size_sqft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    living_area_sqft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bedrooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bathrooms_full: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bathrooms_half: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stories: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parking_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    parking_spaces: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pool: Mapped[bool] = mapped_column(Boolean, default=False)
    waterfront: Mapped[bool] = mapped_column(Boolean, default=False)
    view_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    zoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    hoa_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    hoa_monthly_fee: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    property_tax_annual: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    data_source: Mapped[str] = mapped_column(Text, nullable=False, server_default="MANUAL")
    mls_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    attributes: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    listings: Mapped[list["Listing"]] = relationship("Listing", back_populates="property")
    images: Mapped[list["PropertyImage"]] = relationship(
        "PropertyImage", back_populates="property", cascade="all, delete-orphan"
    )


class Listing(Base):
    __tablename__ = "listings"

    listing_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    property_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("properties.property_id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    status: Mapped[str] = mapped_column(String, nullable=False, server_default="DRAFT")
    list_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    price_currency: Mapped[str] = mapped_column(Text, nullable=False, server_default="USD")
    original_list_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    listing_type: Mapped[str] = mapped_column(Text, nullable=False, server_default="FOR_SALE")
    listing_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    days_on_market: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    highlights: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    listing_agent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", name="fk_listings_listing_agent"), nullable=True
    )
    listing_broker_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.organization_id", name="fk_listings_listing_broker"), nullable=True
    )
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    next_open_house_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    embedding_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)  # FK to ai_embeddings
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, server_default="{}")

    property: Mapped["Property"] = relationship("Property", back_populates="listings")


PropertyImage.property = relationship("Property", back_populates="images")
