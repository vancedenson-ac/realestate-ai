"""Transaction events (read-only; payloads filtered per RLS)."""
from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from realtrust_api.api.deps import get_db_with_rls
from realtrust_api.core.exceptions import not_found_exception
from realtrust_api.domain.events import models as m
from realtrust_api.domain.events import schemas as s
from realtrust_api.domain.transactions import models as txn_m

router = APIRouter()


@router.get("/transactions/{transaction_id}/events", response_model=list[s.DomainEventOverview])
async def list_transaction_events(
    transaction_id: UUID,
    since: datetime | None = Query(None, description="Return events emitted after this time"),
    limit: int = Query(50, le=100),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.DomainEventOverview]:
    """List domain events for a transaction (read-only; payloads redacted per policy)."""
    r = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not r.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    q = (
        select(m.DomainEvent)
        .where(m.DomainEvent.transaction_id == transaction_id)
        .order_by(m.DomainEvent.emitted_at.desc())
        .limit(limit)
    )
    if since is not None:
        q = q.where(m.DomainEvent.emitted_at >= since)
    result = await db.execute(q)
    rows = result.scalars().all()
    return [s.DomainEventOverview.model_validate(e) for e in rows]
