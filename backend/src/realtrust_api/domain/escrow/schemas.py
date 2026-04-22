"""Pydantic schemas for escrow endpoints (09-views-and-apis)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class EscrowAssignmentOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    assignment_id: UUID
    transaction_id: UUID
    escrow_officer_id: UUID
    assigned_by_user_id: UUID
    assigned_at: datetime
    is_active: bool


class EscrowAssignmentCreate(BaseModel):
    escrow_officer_id: UUID


class EarnestMoneyOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    deposit_id: UUID
    transaction_id: UUID
    amount: float | None = None
    confirmed_by_user_id: UUID
    confirmed_at: datetime
    notes: str | None = None


class EarnestMoneyConfirm(BaseModel):
    amount: float | None = None
    notes: str | None = None


class FundingConfirmationOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    confirmation_id: UUID
    transaction_id: UUID
    confirmed_by_user_id: UUID
    confirmed_at: datetime
    verified: bool
    notes: str | None = None


class FundingConfirm(BaseModel):
    verified: bool = Field(default=True, description="Whether funds are verified/cleared")
    notes: str | None = None


class DisbursementOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    disbursement_id: UUID
    transaction_id: UUID
    amount: float | None = None
    recipient: str | None = None
    recorded_by_user_id: UUID
    recorded_at: datetime
    notes: str | None = None


class DisbursementCreate(BaseModel):
    amount: float | None = None
    recipient: str | None = None
    notes: str | None = None

