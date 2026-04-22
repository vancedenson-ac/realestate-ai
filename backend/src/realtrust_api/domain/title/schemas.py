"""Pydantic schemas for title/recording endpoints (09-views-and-apis)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TitleOrderOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    title_order_id: UUID
    transaction_id: UUID
    ordered_by_user_id: UUID
    ordered_at: datetime
    status: str
    insurance_bound_at: datetime | None = None


class TitleOrderCreate(BaseModel):
    status: str = Field(default="ORDERED")


class TitleOrderUpdate(BaseModel):
    status: str | None = None
    insurance_bound_at: datetime | None = None


class TitleCommitmentOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    commitment_id: UUID
    transaction_id: UUID
    document_id: UUID | None = None
    received_at: datetime
    exceptions_summary: str | None = None


class TitleCommitmentCreate(BaseModel):
    document_id: UUID | None = None
    exceptions_summary: str | None = None


class DeedRecordingOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    recording_id: UUID
    transaction_id: UUID
    document_id: UUID | None = None
    recorded_at: datetime
    recording_reference: str | None = None


class DeedRecordedCreate(BaseModel):
    document_id: UUID | None = None
    recording_reference: str | None = None


class OwnershipTransferOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    transfer_id: UUID
    transaction_id: UUID
    transferred_at: datetime
    notes: str | None = None


class OwnershipTransferCreate(BaseModel):
    notes: str | None = None


class AppraisalWaiverOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    waiver_id: UUID
    transaction_id: UUID
    waived_by_user_id: UUID
    waived_at: datetime
    reason: str | None = None


class AppraisalWaiverCreate(BaseModel):
    reason: str | None = None

