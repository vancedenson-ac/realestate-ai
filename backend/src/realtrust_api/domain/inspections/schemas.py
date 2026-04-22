"""Pydantic schemas for inspections and appraisals."""
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class InspectionOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    inspection_id: UUID
    transaction_id: UUID
    inspector_id: UUID | None
    status: str
    scheduled_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class InspectionCreate(BaseModel):
    inspector_id: UUID | None = None
    scheduled_at: datetime | None = None


class InspectionSubmit(BaseModel):
    """Submit inspection findings/report (CONFIDENTIAL_ROLE; explicit deny to lenders)."""
    findings: list[dict] = Field(default_factory=list)
    status: str = "completed"


class FindingCreate(BaseModel):
    severity: str = Field(..., min_length=1)
    description: str | None = None
    resolved: bool = False


class AppraisalOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    appraisal_id: UUID
    transaction_id: UUID
    appraiser_id: UUID | None
    status: str
    value_amount: Decimal | None
    created_at: datetime
    updated_at: datetime


class AppraisalCreate(BaseModel):
    appraiser_id: UUID | None = None


class AppraisalSubmit(BaseModel):
    value_amount: Decimal | None = None
    status: str = "completed"
