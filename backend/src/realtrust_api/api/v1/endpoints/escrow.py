"""Escrow/funding endpoints: assignments, deposit confirmation, funding confirmation, disbursements (09-views-and-apis)."""

import json
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from realtrust_api.api.deps import get_correlation_id, get_current_user_id, get_db_with_rls
from realtrust_api.core.audit import write_audit_event
from realtrust_api.core.exceptions import forbidden_by_policy_exception, not_found_exception
from realtrust_api.domain.escrow import models as m
from realtrust_api.domain.escrow import schemas as s
from realtrust_api.domain.transactions import models as txn_m

router = APIRouter()


@router.get(
    "/transactions/{transaction_id}/escrow/assignments",
    response_model=list[s.EscrowAssignmentOverview],
)
async def list_escrow_assignments(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.EscrowAssignmentOverview]:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    result = await db.execute(
        select(m.EscrowAssignment)
        .where(m.EscrowAssignment.transaction_id == transaction_id)
        .order_by(m.EscrowAssignment.assigned_at.desc())
    )
    rows = result.scalars().all()
    return [s.EscrowAssignmentOverview.model_validate(r) for r in rows]


@router.get(
    "/transactions/{transaction_id}/escrow/earnest-money",
    response_model=list[s.EarnestMoneyOverview],
)
async def list_earnest_money(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.EarnestMoneyOverview]:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    result = await db.execute(
        select(m.EarnestMoneyDeposit)
        .where(m.EarnestMoneyDeposit.transaction_id == transaction_id)
        .order_by(m.EarnestMoneyDeposit.confirmed_at.desc())
    )
    rows = result.scalars().all()
    return [s.EarnestMoneyOverview.model_validate(r) for r in rows]


@router.get(
    "/transactions/{transaction_id}/escrow/funding",
    response_model=list[s.FundingConfirmationOverview],
)
async def list_funding_confirmations(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.FundingConfirmationOverview]:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    result = await db.execute(
        select(m.FundingConfirmation)
        .where(m.FundingConfirmation.transaction_id == transaction_id)
        .order_by(m.FundingConfirmation.confirmed_at.desc())
    )
    rows = result.scalars().all()
    return [s.FundingConfirmationOverview.model_validate(r) for r in rows]


@router.get(
    "/transactions/{transaction_id}/escrow/disbursements",
    response_model=list[s.DisbursementOverview],
)
async def list_disbursements(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.DisbursementOverview]:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    result = await db.execute(
        select(m.Disbursement)
        .where(m.Disbursement.transaction_id == transaction_id)
        .order_by(m.Disbursement.recorded_at.desc())
    )
    rows = result.scalars().all()
    return [s.DisbursementOverview.model_validate(r) for r in rows]


def _role_from_request(request: Request) -> str:
    return (request.headers.get("X-Role") or "").strip() or "BUYER"


async def _emit_event(
    db: AsyncSession,
    *,
    aggregate_type: str,
    aggregate_id: UUID,
    transaction_id: UUID,
    event_type: str,
    payload: dict,
    emitted_by_role: str,
    correlation_id: str | None = None,
) -> None:
    event_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO domain_events (event_id, aggregate_type, aggregate_id, transaction_id, event_type, payload, emitted_by_role, correlation_id) "
            "VALUES (CAST(:event_id AS uuid), :aggregate_type, CAST(:aggregate_id AS uuid), CAST(:transaction_id AS uuid), :event_type, CAST(:payload AS jsonb), :emitted_by_role, :correlation_id)"
        ),
        {
            "event_id": str(event_id),
            "aggregate_type": aggregate_type,
            "aggregate_id": str(aggregate_id),
            "transaction_id": str(transaction_id),
            "event_type": event_type,
            "payload": json.dumps(payload),
            "emitted_by_role": emitted_by_role,
            "correlation_id": correlation_id,
        },
    )
    await db.execute(
        text("INSERT INTO event_outbox (event_id) VALUES (CAST(:event_id AS uuid))"),
        {"event_id": str(event_id)},
    )


@router.post(
    "/transactions/{transaction_id}/escrow/assignments",
    response_model=s.EscrowAssignmentOverview,
    status_code=status.HTTP_201_CREATED,
)
async def assign_escrow_officer(
    transaction_id: UUID,
    body: s.EscrowAssignmentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.EscrowAssignmentOverview:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    txn = tr.scalar_one_or_none()
    if not txn:
        raise not_found_exception("Transaction", str(transaction_id))
    assignment = m.EscrowAssignment(
        transaction_id=transaction_id,
        escrow_officer_id=body.escrow_officer_id,
        assigned_by_user_id=current_user_id,
        is_active=True,
    )
    db.add(assignment)
    await db.flush()
    await _emit_event(
        db,
        aggregate_type="escrow_assignment",
        aggregate_id=assignment.assignment_id,
        transaction_id=transaction_id,
        event_type="EscrowOfficerAssigned",
        payload={"transaction_id": str(transaction_id), "escrow_officer_id": str(body.escrow_officer_id)},
        emitted_by_role=_role_from_request(request),
        correlation_id=correlation_id or None,
    )
    await write_audit_event(
        db,
        event_type="ESCROW_OFFICER_ASSIGNED",
        event_category="modification",
        actor_id=current_user_id,
        actor_role=_role_from_request(request),
        resource_type="escrow_assignment",
        resource_id=assignment.assignment_id,
        transaction_id=transaction_id,
        action="assign_escrow_officer",
        outcome="success",
        details={"escrow_officer_id": str(body.escrow_officer_id)},
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    await db.refresh(assignment)
    return s.EscrowAssignmentOverview.model_validate(assignment)


@router.post(
    "/transactions/{transaction_id}/escrow/earnest-money/confirm",
    response_model=s.EarnestMoneyOverview,
    status_code=status.HTTP_201_CREATED,
)
async def confirm_earnest_money(
    transaction_id: UUID,
    body: s.EarnestMoneyConfirm,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.EarnestMoneyOverview:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    dep = m.EarnestMoneyDeposit(
        transaction_id=transaction_id,
        amount=body.amount,
        confirmed_by_user_id=current_user_id,
        notes=body.notes,
    )
    db.add(dep)
    await db.flush()
    await _emit_event(
        db,
        aggregate_type="earnest_money_deposit",
        aggregate_id=dep.deposit_id,
        transaction_id=transaction_id,
        event_type="EarnestMoneyConfirmed",
        payload={"transaction_id": str(transaction_id)},
        emitted_by_role=_role_from_request(request),
        correlation_id=correlation_id or None,
    )
    await write_audit_event(
        db,
        event_type="EARNEST_MONEY_CONFIRMED",
        event_category="compliance",
        actor_id=current_user_id,
        actor_role=_role_from_request(request),
        resource_type="earnest_money_deposit",
        resource_id=dep.deposit_id,
        transaction_id=transaction_id,
        action="confirm_earnest_money",
        outcome="success",
        details={"amount": body.amount, "notes": body.notes},
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    await db.refresh(dep)
    return s.EarnestMoneyOverview.model_validate(dep)


@router.post(
    "/transactions/{transaction_id}/escrow/funding/confirm",
    response_model=s.FundingConfirmationOverview,
    status_code=status.HTTP_201_CREATED,
)
async def confirm_funding(
    transaction_id: UUID,
    body: s.FundingConfirm,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.FundingConfirmationOverview:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    conf = m.FundingConfirmation(
        transaction_id=transaction_id,
        confirmed_by_user_id=current_user_id,
        verified=body.verified,
        notes=body.notes,
    )
    db.add(conf)
    try:
        await db.flush()
    except (ProgrammingError, IntegrityError) as e:
        msg = str(e).lower()
        if "row-level security" in msg or "rls" in msg or "policy" in msg or (getattr(e, "orig", None) and "insufficientprivilege" in type(e.orig).__name__.lower()):
            raise forbidden_by_policy_exception(
                "Only an escrow officer may confirm funding, and only when the transaction is in Clear to Close or Closed.",
                details={"transaction_id": str(transaction_id)},
            ) from e
        raise
    await _emit_event(
        db,
        aggregate_type="funding_confirmation",
        aggregate_id=conf.confirmation_id,
        transaction_id=transaction_id,
        event_type="FundingConfirmed",
        payload={"transaction_id": str(transaction_id), "verified": body.verified},
        emitted_by_role=_role_from_request(request),
        correlation_id=correlation_id or None,
    )
    await write_audit_event(
        db,
        event_type="FUNDING_CONFIRMED",
        event_category="compliance",
        actor_id=current_user_id,
        actor_role=_role_from_request(request),
        resource_type="funding_confirmation",
        resource_id=conf.confirmation_id,
        transaction_id=transaction_id,
        action="confirm_funding",
        outcome="success",
        details={"verified": body.verified, "notes": body.notes},
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    await db.refresh(conf)
    return s.FundingConfirmationOverview.model_validate(conf)


@router.post(
    "/transactions/{transaction_id}/escrow/disbursements",
    response_model=s.DisbursementOverview,
    status_code=status.HTTP_201_CREATED,
)
async def record_disbursement(
    transaction_id: UUID,
    body: s.DisbursementCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.DisbursementOverview:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    d = m.Disbursement(
        transaction_id=transaction_id,
        amount=body.amount,
        recipient=body.recipient,
        recorded_by_user_id=current_user_id,
        notes=body.notes,
    )
    db.add(d)
    try:
        await db.flush()
    except (ProgrammingError, IntegrityError) as e:
        msg = str(e).lower()
        if "row-level security" in msg or "rls" in msg or "policy" in msg or (getattr(e, "orig", None) and "insufficientprivilege" in type(e.orig).__name__.lower()):
            raise forbidden_by_policy_exception(
                "Only an escrow officer may record disbursements, and only when the transaction is in Clear to Close or Closed.",
                details={"transaction_id": str(transaction_id)},
            ) from e
        raise
    await _emit_event(
        db,
        aggregate_type="disbursement",
        aggregate_id=d.disbursement_id,
        transaction_id=transaction_id,
        event_type="DisbursementRecorded",
        payload={"transaction_id": str(transaction_id)},
        emitted_by_role=_role_from_request(request),
        correlation_id=correlation_id or None,
    )
    await write_audit_event(
        db,
        event_type="DISBURSEMENT_RECORDED",
        event_category="compliance",
        actor_id=current_user_id,
        actor_role=_role_from_request(request),
        resource_type="disbursement",
        resource_id=d.disbursement_id,
        transaction_id=transaction_id,
        action="record_disbursement",
        outcome="success",
        details={"amount": body.amount, "recipient": body.recipient, "notes": body.notes},
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    await db.refresh(d)
    return s.DisbursementOverview.model_validate(d)

