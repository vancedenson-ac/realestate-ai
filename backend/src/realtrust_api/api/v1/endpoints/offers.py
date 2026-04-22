"""Offer endpoints: submit/counter/accept/reject/withdraw (09-views-and-apis)."""

import json
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from realtrust_api.api.deps import get_correlation_id, get_current_user_id, get_db_with_rls
from realtrust_api.core.audit import write_audit_event
from realtrust_api.core.exceptions import not_found_exception, precondition_failed_exception, validation_exception
from realtrust_api.domain.documents import models as doc_m
from realtrust_api.domain.offers import models as m
from realtrust_api.domain.offers import schemas as s
from realtrust_api.domain.transactions import models as txn_m

router = APIRouter()


def _role_from_request(request: Request) -> str:
    # In dev, role comes from headers; in production it MUST come from validated identity.
    return (request.headers.get("X-Role") or "").strip() or "BUYER"


async def _emit_event(
    db: AsyncSession,
    *,
    aggregate_type: str,
    aggregate_id: UUID,
    transaction_id: UUID | None,
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
            "transaction_id": str(transaction_id) if transaction_id is not None else None,
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


@router.get("/transactions/{transaction_id}/offers", response_model=list[s.OfferOverview])
async def list_offers(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.OfferOverview]:
    r = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not r.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    result = await db.execute(
        select(m.Offer).where(m.Offer.transaction_id == transaction_id).order_by(m.Offer.created_at.desc())
    )
    rows = result.scalars().all()
    return [s.OfferOverview.model_validate(o) for o in rows]


@router.post(
    "/transactions/{transaction_id}/offers",
    response_model=s.OfferOverview,
    status_code=status.HTTP_201_CREATED,
)
async def submit_offer(
    transaction_id: UUID,
    body: s.OfferCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.OfferOverview:
    """Submit an offer (authoritative). Ensures submitter is a transaction party for RLS."""
    role = _role_from_request(request)
    if role not in ("BUYER", "BUYER_AGENT"):
        raise validation_exception("Only BUYER/BUYER_AGENT can submit offers", {"role": role})

    tr = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    txn = tr.scalar_one_or_none()
    if not txn:
        raise not_found_exception("Transaction", str(transaction_id))

    # Bind caller as a party (required for RLS visibility) if not already present for this role.
    pr = await db.execute(
        select(txn_m.TransactionParty).where(
            txn_m.TransactionParty.transaction_id == transaction_id,
            txn_m.TransactionParty.user_id == current_user_id,
            txn_m.TransactionParty.role == role,
        )
    )
    if not pr.scalar_one_or_none():
        db.add(
            txn_m.TransactionParty(
                transaction_id=transaction_id,
                user_id=current_user_id,
                organization_id=txn.organization_id,
                role=role,
            )
        )
        await db.flush()

    offer = m.Offer(
        transaction_id=transaction_id,
        parent_offer_id=None,
        document_id=body.document_id,
        status="SUBMITTED",
        terms=body.terms or {},
        created_by_user_id=current_user_id,
    )
    db.add(offer)
    await db.flush()

    await _emit_event(
        db,
        aggregate_type="offer",
        aggregate_id=offer.offer_id,
        transaction_id=transaction_id,
        event_type="OfferSubmitted",
        payload={"offer_id": str(offer.offer_id), "transaction_id": str(transaction_id)},
        emitted_by_role=role,
        correlation_id=correlation_id or None,
    )

    # Attempt macro transition LISTED → OFFER_MADE if requirements are met (offer doc must be signed).
    try:
        async with db.begin_nested():
            await db.execute(
                text("SELECT transition_transaction_state(CAST(:tid AS uuid), CAST(:to_state AS text), :correlation_id)"),
                {"tid": str(transaction_id), "to_state": "OFFER_MADE", "correlation_id": correlation_id or None},
            )
    except Exception:
        # It's fine if state can't move yet (missing signed offer doc). Offer fact is still valid.
        # Use nested transaction so a failed transition doesn't poison the outer transaction.
        pass

    await db.refresh(offer)
    return s.OfferOverview.model_validate(offer)


@router.post("/offers/{offer_id}/counter", response_model=s.OfferOverview, status_code=status.HTTP_201_CREATED)
async def counter_offer(
    offer_id: UUID,
    body: s.OfferCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.OfferOverview:
    role = _role_from_request(request)
    # Counter can be made by either side (policy may restrict further).
    r = await db.execute(select(m.Offer).where(m.Offer.offer_id == offer_id))
    parent = r.scalar_one_or_none()
    if not parent:
        raise not_found_exception("Offer", str(offer_id))

    parent.status = "COUNTERED"
    child = m.Offer(
        transaction_id=parent.transaction_id,
        parent_offer_id=parent.offer_id,
        document_id=body.document_id,
        status="SUBMITTED",
        terms=body.terms or {},
        created_by_user_id=current_user_id,
    )
    db.add(child)
    db.add(
        m.OfferDecision(
            offer_id=parent.offer_id,
            decision="COUNTER",
            decided_by_user_id=current_user_id,
            reason=None,
        )
    )
    await db.flush()

    await _emit_event(
        db,
        aggregate_type="offer",
        aggregate_id=child.offer_id,
        transaction_id=parent.transaction_id,
        event_type="OfferCountered",
        payload={"offer_id": str(child.offer_id), "parent_offer_id": str(parent.offer_id)},
        emitted_by_role=role,
        correlation_id=correlation_id or None,
    )
    await db.refresh(child)
    return s.OfferOverview.model_validate(child)


@router.post("/offers/{offer_id}/withdraw", response_model=s.OfferOverview)
async def withdraw_offer(
    offer_id: UUID,
    body: s.OfferDecisionBody,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.OfferOverview:
    role = _role_from_request(request)
    r = await db.execute(select(m.Offer).where(m.Offer.offer_id == offer_id))
    offer = r.scalar_one_or_none()
    if not offer:
        raise not_found_exception("Offer", str(offer_id))
    if offer.created_by_user_id != current_user_id:
        raise precondition_failed_exception("Only the creator may withdraw an offer", {"offer_id": str(offer_id)})
    offer.status = "WITHDRAWN"
    db.add(
        m.OfferDecision(
            offer_id=offer.offer_id,
            decision="WITHDRAW",
            decided_by_user_id=current_user_id,
            reason=body.reason,
        )
    )
    await db.flush()
    await _emit_event(
        db,
        aggregate_type="offer",
        aggregate_id=offer.offer_id,
        transaction_id=offer.transaction_id,
        event_type="OfferWithdrawn",
        payload={"offer_id": str(offer.offer_id)},
        emitted_by_role=role,
        correlation_id=correlation_id or None,
    )
    await db.refresh(offer)
    return s.OfferOverview.model_validate(offer)


@router.post("/offers/{offer_id}/reject", response_model=s.OfferOverview)
async def reject_offer(
    offer_id: UUID,
    body: s.OfferDecisionBody,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.OfferOverview:
    role = _role_from_request(request)
    if role not in ("SELLER", "SELLER_AGENT"):
        raise validation_exception("Only SELLER/SELLER_AGENT may reject offers", {"role": role})
    r = await db.execute(select(m.Offer).where(m.Offer.offer_id == offer_id))
    offer = r.scalar_one_or_none()
    if not offer:
        raise not_found_exception("Offer", str(offer_id))
    offer.status = "REJECTED"
    db.add(
        m.OfferDecision(
            offer_id=offer.offer_id,
            decision="REJECT",
            decided_by_user_id=current_user_id,
            reason=body.reason,
        )
    )
    await db.flush()
    await _emit_event(
        db,
        aggregate_type="offer",
        aggregate_id=offer.offer_id,
        transaction_id=offer.transaction_id,
        event_type="OfferRejected",
        payload={"offer_id": str(offer.offer_id)},
        emitted_by_role=role,
        correlation_id=correlation_id or None,
    )
    await db.refresh(offer)
    return s.OfferOverview.model_validate(offer)


@router.post("/offers/{offer_id}/accept", response_model=s.OfferOverview)
async def accept_offer(
    offer_id: UUID,
    body: s.OfferAcceptBody,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.OfferOverview:
    role = _role_from_request(request)
    if role not in ("SELLER", "SELLER_AGENT"):
        raise validation_exception("Only SELLER/SELLER_AGENT may accept offers", {"role": role})
    r = await db.execute(select(m.Offer).where(m.Offer.offer_id == offer_id))
    offer = r.scalar_one_or_none()
    if not offer:
        raise not_found_exception("Offer", str(offer_id))

    # Ensure purchase agreement evidence is present and signed (required by state machine).
    dr = await db.execute(select(doc_m.Document).where(doc_m.Document.document_id == body.purchase_agreement_document_id))
    doc = dr.scalar_one_or_none()
    if not doc or doc.transaction_id != offer.transaction_id:
        raise not_found_exception("Document", str(body.purchase_agreement_document_id))
    if doc.document_type != "purchase_agreement" or doc.execution_status != "signed":
        raise precondition_failed_exception(
            "Purchase agreement must be signed to accept offer",
            {"document_id": str(body.purchase_agreement_document_id)},
        )

    offer.status = "ACCEPTED"
    db.add(
        m.OfferDecision(
            offer_id=offer.offer_id,
            decision="ACCEPT",
            decided_by_user_id=current_user_id,
            reason=body.reason,
        )
    )
    await db.flush()

    await _emit_event(
        db,
        aggregate_type="offer",
        aggregate_id=offer.offer_id,
        transaction_id=offer.transaction_id,
        event_type="OfferAccepted",
        payload={"offer_id": str(offer.offer_id), "purchase_agreement_document_id": str(body.purchase_agreement_document_id)},
        emitted_by_role=role,
        correlation_id=correlation_id or None,
    )

    # Transition macro-state OFFER_MADE → UNDER_CONTRACT (DB is final authority).
    await db.execute(
        text("SELECT transition_transaction_state(CAST(:tid AS uuid), CAST(:to_state AS text), :correlation_id)"),
        {"tid": str(offer.transaction_id), "to_state": "UNDER_CONTRACT", "correlation_id": correlation_id or None},
    )

    await write_audit_event(
        db,
        event_type="OFFER_ACCEPTED",
        event_category="modification",
        actor_id=current_user_id,
        actor_role=role,
        resource_type="offer",
        resource_id=offer.offer_id,
        transaction_id=offer.transaction_id,
        action="accept_offer",
        outcome="success",
        details={"purchase_agreement_document_id": str(body.purchase_agreement_document_id)},
        correlation_id=correlation_id or None,
    )

    await db.refresh(offer)
    return s.OfferOverview.model_validate(offer)

