"""Pydantic schemas for showings endpoints (09-views-and-apis)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ShowingOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    showing_id: UUID
    listing_id: UUID
    scheduled_start_at: datetime
    scheduled_end_at: datetime | None = None
    status: str
    showing_type: str = "PRIVATE"
    requested_by_user_id: UUID | None = None
    created_by_user_id: UUID
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class ShowingCreate(BaseModel):
    scheduled_start_at: datetime
    scheduled_end_at: datetime | None = None
    showing_type: str = Field("PRIVATE", description="PRIVATE or OPEN_HOUSE")
    requested_by_user_id: UUID | None = Field(None, description="Optional buyer identity (policy-filtered)")
    notes: str | None = None


class ShowingUpdate(BaseModel):
    scheduled_start_at: datetime | None = None
    scheduled_end_at: datetime | None = None
    status: str | None = Field(None, description="SCHEDULED|COMPLETED|CANCELLED|NO_SHOW")
    showing_type: str | None = Field(None, description="PRIVATE or OPEN_HOUSE")
    notes: str | None = None


class ShowingFeedbackOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    feedback_id: UUID
    listing_id: UUID
    showing_id: UUID
    from_user_id: UUID
    rating: str | None = None
    notes: str | None = None
    created_at: datetime


class ShowingFeedbackCreate(BaseModel):
    rating: str | None = Field(None, description="POSITIVE|NEUTRAL|NEGATIVE|NO_SHOW")
    notes: str | None = None

