"""Appraisal endpoints: create, submit (09-views-and-apis). Policy: only LENDER or ESCROW_OFFICER may order (create) an appraisal."""
from uuid import UUID
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from realtrust_api.api.deps import get_db_with_rls
from realtrust_api.core.exceptions import not_found_exception, validation_exception
from realtrust_api.domain.inspections import models as m
from realtrust_api.domain.inspections import schemas as s
from realtrust_api.domain.transactions import models as txn_m

router = APIRouter()


def _role_from_request(request: Request) -> str:
    return (request.headers.get("X-Role") or "").strip().upper() or ""


@router.post("/transactions/{transaction_id}/appraisals", response_model=s.AppraisalOverview, status_code=status.HTTP_201_CREATED)
async def create_appraisal(
    transaction_id: UUID,
    body: s.AppraisalCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.AppraisalOverview:
    """Create (order) appraisal for a transaction. Only LENDER or ESCROW_OFFICER may create."""
    role = _role_from_request(request)
    if role not in ("LENDER", "ESCROW_OFFICER"):
        raise validation_exception(
            "Only LENDER or ESCROW_OFFICER may order an appraisal",
            {"role": role},
        )
    r = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not r.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    appr = m.Appraisal(
        transaction_id=transaction_id,
        appraiser_id=body.appraiser_id,
    )
    db.add(appr)
    await db.flush()
    await db.refresh(appr)
    return s.AppraisalOverview.model_validate(appr)


@router.get("/appraisals/{appraisal_id}", response_model=s.AppraisalOverview)
async def get_appraisal(
    appraisal_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.AppraisalOverview:
    """Get appraisal by id (RLS-filtered)."""
    r = await db.execute(select(m.Appraisal).where(m.Appraisal.appraisal_id == appraisal_id))
    appr = r.scalar_one_or_none()
    if not appr:
        raise not_found_exception("Appraisal", str(appraisal_id))
    return s.AppraisalOverview.model_validate(appr)


@router.post("/appraisals/{appraisal_id}/submit", response_model=s.AppraisalOverview)
async def submit_appraisal(
    appraisal_id: UUID,
    body: s.AppraisalSubmit,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.AppraisalOverview:
    """Submit appraisal (value, status)."""
    r = await db.execute(select(m.Appraisal).where(m.Appraisal.appraisal_id == appraisal_id))
    appr = r.scalar_one_or_none()
    if not appr:
        raise not_found_exception("Appraisal", str(appraisal_id))
    if body.value_amount is not None:
        appr.value_amount = body.value_amount
    appr.status = body.status
    await db.flush()
    await db.refresh(appr)
    return s.AppraisalOverview.model_validate(appr)
