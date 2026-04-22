"""Inspection endpoints: create, submit (09-views-and-apis)."""
from uuid import UUID
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from realtrust_api.api.deps import get_correlation_id, get_current_user_id, get_db_with_rls
from realtrust_api.core.audit import log_access_decision
from realtrust_api.core.exceptions import not_found_exception
from realtrust_api.domain.inspections import models as m
from realtrust_api.domain.inspections import schemas as s
from realtrust_api.domain.transactions import models as txn_m

router = APIRouter()


@router.get("/transactions/{transaction_id}/inspections", response_model=list[s.InspectionOverview])
async def list_inspections(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.InspectionOverview]:
    """List inspections for a transaction (RLS-filtered; lender explicit deny)."""
    r = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not r.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    result = await db.execute(
        select(m.Inspection)
        .where(m.Inspection.transaction_id == transaction_id)
        .order_by(m.Inspection.created_at.desc())
    )
    rows = result.scalars().all()
    return [s.InspectionOverview.model_validate(x) for x in rows]


@router.post("/transactions/{transaction_id}/inspections", response_model=s.InspectionOverview, status_code=status.HTTP_201_CREATED)
async def create_inspection(
    transaction_id: UUID,
    body: s.InspectionCreate,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.InspectionOverview:
    """Create inspection assignment for a transaction."""
    r = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not r.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    insp = m.Inspection(
        transaction_id=transaction_id,
        inspector_id=body.inspector_id,
        scheduled_at=body.scheduled_at,
    )
    db.add(insp)
    await db.flush()
    await db.refresh(insp)
    return s.InspectionOverview.model_validate(insp)


@router.get("/inspections/{inspection_id}", response_model=s.InspectionOverview)
async def get_inspection(
    inspection_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.InspectionOverview:
    """Get inspection by id (RLS-filtered; lender explicit deny). Logs access decision (02 §5, AUDIT §8.3)."""
    r = await db.execute(select(m.Inspection).where(m.Inspection.inspection_id == inspection_id))
    insp = r.scalar_one_or_none()
    role = (request.headers.get("X-Role") or "").strip() or ""
    await log_access_decision(
        db,
        actor_id=current_user_id,
        actor_role=role,
        resource_type="inspection",
        resource_id=inspection_id,
        transaction_id=insp.transaction_id if insp else None,
        outcome="allow" if insp else "deny",
        policy_reference="06-RLS-inspections",
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    if not insp:
        await db.commit()
        raise not_found_exception("Inspection", str(inspection_id))
    return s.InspectionOverview.model_validate(insp)


@router.post("/inspections/{inspection_id}/submit", response_model=s.InspectionOverview)
async def submit_inspection(
    inspection_id: UUID,
    body: s.InspectionSubmit,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.InspectionOverview:
    """Submit inspection findings/report (CONFIDENTIAL_ROLE; explicit deny to lenders)."""
    from datetime import datetime, timezone
    r = await db.execute(select(m.Inspection).where(m.Inspection.inspection_id == inspection_id))
    insp = r.scalar_one_or_none()
    if not insp:
        raise not_found_exception("Inspection", str(inspection_id))
    insp.status = body.status
    insp.completed_at = datetime.now(timezone.utc)
    for f in body.findings:
        finding = m.InspectionFinding(
            inspection_id=inspection_id,
            severity=f.get("severity", "unknown"),
            description=f.get("description"),
            resolved=f.get("resolved", False),
        )
        db.add(finding)
    await db.flush()
    await db.refresh(insp)
    return s.InspectionOverview.model_validate(insp)
