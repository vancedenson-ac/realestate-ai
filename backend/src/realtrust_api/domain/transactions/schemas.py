"""Pydantic schemas for transaction API (read/command)."""
from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


# ----- Transaction overview (read) -----
class TransactionOverview(BaseModel):
    """Transaction overview view (RLS-filtered)."""

    model_config = ConfigDict(from_attributes=True)

    transaction_id: UUID
    organization_id: UUID
    current_state: str
    state_entered_at: datetime
    jurisdiction: str | None = None
    offer_price: float | None = None
    property_id: UUID | None = None
    listing_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class TransactionPartySummary(BaseModel):
    """Party summary for transaction overview."""

    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    organization_id: UUID
    role: str
    created_at: datetime


# ----- Create transaction (command) -----
class TransactionCreate(BaseModel):
    """Create a new transaction in initial state (e.g. PRE_LISTING). Binds current user as initial party for RLS."""

    organization_id: UUID
    initial_state: str = Field(default="PRE_LISTING", description="Must be valid state from state machine")
    initial_party_role: str = Field(
        default="SELLER_AGENT",
        description="Role for current user as first party (required for RLS visibility)",
    )
    property_id: UUID | None = Field(default=None, description="Optional link to property (journey context)")
    listing_id: UUID | None = Field(default=None, description="Optional link to listing (LISTED transactions)")


# ----- Transition (command) -----
class TransitionRequest(BaseModel):
    """Request to transition transaction state (DB is final authority)."""

    to_state: str = Field(..., description="Target state from state machine")
    action: str | None = Field(None, description="Optional action label for audit")
    metadata: dict | None = Field(None, description="Optional metadata for audit")


# ----- Party (command) -----
class PartyCreate(BaseModel):
    """Add or update party binding (policy-controlled; changes visibility boundaries)."""
    user_id: UUID
    organization_id: UUID
    role: str = Field(..., min_length=1)


# ----- List response -----
class TransactionListResponse(BaseModel):
    """Paginated list of transaction overviews."""

    data: list[TransactionOverview]
    meta: dict = Field(default_factory=lambda: {"limit": 20, "cursor": None})


class DocumentChecklistItem(BaseModel):
    """Required document for an outgoing transition (05/17)."""
    kind: Literal["document"] = "document"
    document_type: str
    required_for_to_state: str
    present: bool
    signed: bool


class MilestoneChecklistItem(BaseModel):
    """Milestone precondition for an outgoing transition (05/17)."""
    kind: Literal["milestone"] = "milestone"
    milestone_key: str
    label: str
    required_for_to_state: str
    present: bool


class TransactionTimelineStateChange(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    from_state: str
    to_state: str
    entered_at: datetime
    actor_role: str


class TransactionTimeline(BaseModel):
    state_changes: list[TransactionTimelineStateChange]
    events: list[dict]  # DomainEventOverview-like items; defined in events domain
