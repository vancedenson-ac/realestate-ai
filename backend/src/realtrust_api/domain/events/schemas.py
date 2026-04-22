"""Pydantic schemas for domain events (read-only; payloads filtered per RLS)."""
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict


class DomainEventOverview(BaseModel):
    """Redacted event for API; do not leak restricted payloads."""
    model_config = ConfigDict(from_attributes=True)

    event_id: UUID
    aggregate_type: str
    aggregate_id: UUID
    transaction_id: UUID | None
    event_type: str
    emitted_at: datetime
    emitted_by_role: str
    correlation_id: str | None
    # payload omitted or redacted per policy
