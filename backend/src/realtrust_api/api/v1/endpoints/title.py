"""Title/recording endpoints: title orders/commitments/clearance; deed recorded; ownership transfer; appraisal waiver."""

import json
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from realtrust_api.api.deps import get_correlation_id, get_current_user_id, get_db_with_rls
from realtrust_api.core.audit import write_audit_event
from realtrust_api.core.exceptions import forbidden_by_policy_exception, not_found_exception
from realtrust_api.domain.title import models as m
from realtrust_api.domain.title import schemas as s
from realtrust_api.domain.transactions import models as txn_m

router = APIRouter()


@router.get(
    "/transactions/{transaction_id}/title/orders",
    response_model=list[s.TitleOrderOverview],
)
async def list_title_orders(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.TitleOrderOverview]:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    result = await db.execute(
        select(m.TitleOrder)
        .where(m.TitleOrder.transaction_id == transaction_id)
        .order_by(m.TitleOrder.ordered_at.desc())
    )
    rows = result.scalars().all()
    return [s.TitleOrderOverview.model_validate(r) for r in rows]


@router.get(
    "/transactions/{transaction_id}/title/commitments",
    response_model=list[s.TitleCommitmentOverview],
)
async def list_title_commitments(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.TitleCommitmentOverview]:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    result = await db.execute(
        select(m.TitleCommitment)
        .where(m.TitleCommitment.transaction_id == transaction_id)
        .order_by(m.TitleCommitment.received_at.desc())
    )
    rows = result.scalars().all()
    return [s.TitleCommitmentOverview.model_validate(r) for r in rows]


@router.get(
    "/transactions/{transaction_id}/closing/deed-recordings",
    response_model=list[s.DeedRecordingOverview],
)
async def list_deed_recordings(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.DeedRecordingOverview]:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    result = await db.execute(
        select(m.DeedRecording)
        .where(m.DeedRecording.transaction_id == transaction_id)
        .order_by(m.DeedRecording.recorded_at.desc())
    )
    rows = result.scalars().all()
    return [s.DeedRecordingOverview.model_validate(r) for r in rows]


@router.get(
    "/transactions/{transaction_id}/closing/ownership-transfers",
    response_model=list[s.OwnershipTransferOverview],
)
async def list_ownership_transfers(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.OwnershipTransferOverview]:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    result = await db.execute(
        select(m.OwnershipTransfer)
        .where(m.OwnershipTransfer.transaction_id == transaction_id)
        .order_by(m.OwnershipTransfer.transferred_at.desc())
    )
    rows = result.scalars().all()
    return [s.OwnershipTransferOverview.model_validate(r) for r in rows]


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
    "/transactions/{transaction_id}/title/orders",
    response_model=s.TitleOrderOverview,
    status_code=status.HTTP_201_CREATED,
)
async def create_title_order(
    transaction_id: UUID,
    body: s.TitleOrderCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.TitleOrderOverview:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    order = m.TitleOrder(
        transaction_id=transaction_id,
        ordered_by_user_id=current_user_id,
        status=body.status,
    )
    db.add(order)
    await db.flush()
    await _emit_event(
        db,
        aggregate_type="title_order",
        aggregate_id=order.title_order_id,
        transaction_id=transaction_id,
        event_type="TitleOrdered",
        payload={"transaction_id": str(transaction_id)},
        emitted_by_role=_role_from_request(request),
        correlation_id=correlation_id or None,
    )
    await write_audit_event(
        db,
        event_type="TITLE_ORDERED",
        event_category="modification",
        actor_id=current_user_id,
        actor_role=_role_from_request(request),
        resource_type="title_order",
        resource_id=order.title_order_id,
        transaction_id=transaction_id,
        action="create_title_order",
        outcome="success",
        details={"status": order.status},
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    await db.refresh(order)
    return s.TitleOrderOverview.model_validate(order)


@router.patch("/title/orders/{title_order_id}", response_model=s.TitleOrderOverview)
async def update_title_order(
    title_order_id: UUID,
    body: s.TitleOrderUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.TitleOrderOverview:
    r = await db.execute(select(m.TitleOrder).where(m.TitleOrder.title_order_id == title_order_id))
    order = r.scalar_one_or_none()
    if not order:
        raise not_found_exception("TitleOrder", str(title_order_id))
    update_data = body.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(order, k, v)
    await db.flush()
    await _emit_event(
        db,
        aggregate_type="title_order",
        aggregate_id=order.title_order_id,
        transaction_id=order.transaction_id,
        event_type="TitleOrderUpdated",
        payload={"title_order_id": str(order.title_order_id), "status": order.status},
        emitted_by_role=_role_from_request(request),
        correlation_id=correlation_id or None,
    )
    await write_audit_event(
        db,
        event_type="TITLE_ORDER_UPDATED",
        event_category="modification",
        actor_id=current_user_id,
        actor_role=_role_from_request(request),
        resource_type="title_order",
        resource_id=order.title_order_id,
        transaction_id=order.transaction_id,
        action="update_title_order",
        outcome="success",
        details=update_data,
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    await db.refresh(order)
    return s.TitleOrderOverview.model_validate(order)


@router.post(
    "/transactions/{transaction_id}/title/commitments",
    response_model=s.TitleCommitmentOverview,
    status_code=status.HTTP_201_CREATED,
)
async def create_title_commitment(
    transaction_id: UUID,
    body: s.TitleCommitmentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.TitleCommitmentOverview:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    c = m.TitleCommitment(
        transaction_id=transaction_id,
        document_id=body.document_id,
        exceptions_summary=body.exceptions_summary,
    )
    db.add(c)
    await db.flush()
    await _emit_event(
        db,
        aggregate_type="title_commitment",
        aggregate_id=c.commitment_id,
        transaction_id=transaction_id,
        event_type="TitleCommitmentReceived",
        payload={"transaction_id": str(transaction_id), "commitment_id": str(c.commitment_id)},
        emitted_by_role=_role_from_request(request),
        correlation_id=correlation_id or None,
    )
    # Title commitment receipt is auditable; details may be policy-filtered.
    await write_audit_event(
        db,
        event_type="TITLE_COMMITMENT_RECEIVED",
        event_category="compliance",
        actor_id=current_user_id,
        actor_role=_role_from_request(request),
        resource_type="title_commitment",
        resource_id=c.commitment_id,
        transaction_id=transaction_id,
        action="create_title_commitment",
        outcome="success",
        details={"document_id": str(body.document_id) if body.document_id else None},
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    await db.refresh(c)
    return s.TitleCommitmentOverview.model_validate(c)


@router.post(
    "/transactions/{transaction_id}/closing/deed-recorded",
    response_model=s.DeedRecordingOverview,
    status_code=status.HTTP_201_CREATED,
)
async def record_deed_recording(
    transaction_id: UUID,
    body: s.DeedRecordedCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.DeedRecordingOverview:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    rec = m.DeedRecording(
        transaction_id=transaction_id,
        document_id=body.document_id,
        recording_reference=body.recording_reference,
    )
    db.add(rec)
    await db.flush()
    await _emit_event(
        db,
        aggregate_type="deed_recording",
        aggregate_id=rec.recording_id,
        transaction_id=transaction_id,
        event_type="DeedRecorded",
        payload={"transaction_id": str(transaction_id), "recording_id": str(rec.recording_id)},
        emitted_by_role=_role_from_request(request),
        correlation_id=correlation_id or None,
    )
    await write_audit_event(
        db,
        event_type="DEED_RECORDED",
        event_category="compliance",
        actor_id=current_user_id,
        actor_role=_role_from_request(request),
        resource_type="deed_recording",
        resource_id=rec.recording_id,
        transaction_id=transaction_id,
        action="record_deed_recording",
        outcome="success",
        details={"recording_reference": body.recording_reference},
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    await db.refresh(rec)
    return s.DeedRecordingOverview.model_validate(rec)


@router.post(
    "/transactions/{transaction_id}/closing/ownership-transfer",
    response_model=s.OwnershipTransferOverview,
    status_code=status.HTTP_201_CREATED,
)
async def record_ownership_transfer(
    transaction_id: UUID,
    body: s.OwnershipTransferCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.OwnershipTransferOverview:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    transfer = m.OwnershipTransfer(transaction_id=transaction_id, notes=body.notes)
    db.add(transfer)
    try:
        await db.flush()
    except (ProgrammingError, IntegrityError) as e:
        msg = str(e).lower()
        if "row-level security" in msg or "rls" in msg or "policy" in msg or (getattr(e, "orig", None) and "insufficientprivilege" in type(e.orig).__name__.lower()):
            raise forbidden_by_policy_exception(
                "Only an escrow officer may confirm ownership transfer, and only when the transaction is in Clear to Close or Closed.",
                details={"transaction_id": str(transaction_id)},
            ) from e
        raise
    await _emit_event(
        db,
        aggregate_type="ownership_transfer",
        aggregate_id=transfer.transfer_id,
        transaction_id=transaction_id,
        event_type="OwnershipTransferConfirmed",
        payload={"transaction_id": str(transaction_id), "transfer_id": str(transfer.transfer_id)},
        emitted_by_role=_role_from_request(request),
        correlation_id=correlation_id or None,
    )
    await write_audit_event(
        db,
        event_type="OWNERSHIP_TRANSFER_CONFIRMED",
        event_category="compliance",
        actor_id=current_user_id,
        actor_role=_role_from_request(request),
        resource_type="ownership_transfer",
        resource_id=transfer.transfer_id,
        transaction_id=transaction_id,
        action="record_ownership_transfer",
        outcome="success",
        details={"notes": body.notes},
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    await db.refresh(transfer)
    return s.OwnershipTransferOverview.model_validate(transfer)


@router.get(
    "/transactions/{transaction_id}/appraisals/waivers",
    response_model=list[s.AppraisalWaiverOverview],
)
async def list_appraisal_waivers(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.AppraisalWaiverOverview]:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    result = await db.execute(
        select(m.AppraisalWaiver)
        .where(m.AppraisalWaiver.transaction_id == transaction_id)
        .order_by(m.AppraisalWaiver.waived_at.desc())
    )
    rows = result.scalars().all()
    return [s.AppraisalWaiverOverview.model_validate(r) for r in rows]


@router.post(
    "/transactions/{transaction_id}/appraisals/waive",
    response_model=s.AppraisalWaiverOverview,
    status_code=status.HTTP_201_CREATED,
)
async def waive_appraisal(
    transaction_id: UUID,
    body: s.AppraisalWaiverCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.AppraisalWaiverOverview:
    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    w = m.AppraisalWaiver(transaction_id=transaction_id, waived_by_user_id=current_user_id, reason=body.reason)
    db.add(w)
    await db.flush()
    await _emit_event(
        db,
        aggregate_type="appraisal_waiver",
        aggregate_id=w.waiver_id,
        transaction_id=transaction_id,
        event_type="AppraisalWaived",
        payload={"transaction_id": str(transaction_id), "waiver_id": str(w.waiver_id)},
        emitted_by_role=_role_from_request(request),
        correlation_id=correlation_id or None,
    )
    await write_audit_event(
        db,
        event_type="APPRAISAL_WAIVED",
        event_category="modification",
        actor_id=current_user_id,
        actor_role=_role_from_request(request),
        resource_type="appraisal_waiver",
        resource_id=w.waiver_id,
        transaction_id=transaction_id,
        action="waive_appraisal",
        outcome="success",
        details={"reason": body.reason},
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    await db.refresh(w)
    return s.AppraisalWaiverOverview.model_validate(w)

