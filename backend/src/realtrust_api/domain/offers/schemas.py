"""Pydantic schemas for offers endpoints (09-views-and-apis)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OfferOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    offer_id: UUID
    transaction_id: UUID
    parent_offer_id: UUID | None = None
    document_id: UUID | None = None
    status: str
    terms: dict = Field(default_factory=dict)
    created_by_user_id: UUID
    created_at: datetime
    updated_at: datetime


class OfferCreate(BaseModel):
    document_id: UUID | None = Field(None, description="Optional evidence document_id (document_type=offer)")
    terms: dict = Field(default_factory=dict, description="Offer terms (schema-governed in future)")


class OfferDecisionOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    decision_id: UUID
    offer_id: UUID
    decision: str
    decided_by_user_id: UUID
    decided_at: datetime
    reason: str | None = None


class OfferDecisionBody(BaseModel):
    reason: str | None = Field(None, description="Optional reason (required by some policies)")


class OfferAcceptBody(BaseModel):
    purchase_agreement_document_id: UUID = Field(
        ..., description="Signed purchase agreement evidence (document_type=purchase_agreement)"
    )
    reason: str | None = None

