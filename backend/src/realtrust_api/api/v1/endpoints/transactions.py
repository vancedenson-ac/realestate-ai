"""Transaction endpoints: list, get, create, transition (09-views-and-apis)."""
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from realtrust_api.api.deps import get_correlation_id, get_current_user_id, get_db_with_rls
from realtrust_api.core.audit import log_access_decision, write_audit_event
from realtrust_api.core.exceptions import (
    illegal_transition_exception,
    not_found_exception,
    precondition_failed_exception,
    validation_exception,
)
from realtrust_api.domain.documents import models as doc_m
from realtrust_api.domain.escrow import models as escrow_m
from realtrust_api.domain.events import models as evt_m
from realtrust_api.domain.events import schemas as evt_s
from realtrust_api.domain.inspections import models as insp_m
from realtrust_api.domain.title import models as title_m
from realtrust_api.domain.transactions import models as m
from realtrust_api.domain.transactions import schemas as s

router = APIRouter()


@router.get("", response_model=s.TransactionListResponse)
async def list_transactions(
    cursor: UUID | None = None,
    limit: int = 20,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.TransactionListResponse:
    """List transactions (query layer: DB view; RLS is final authority)."""
    limit_capped = min(limit, 100)
    if cursor:
        q = text(
            "SELECT * FROM v_transaction_overviews_v1 "
            "WHERE transaction_id < CAST(:cursor AS uuid) "
            "ORDER BY created_at DESC "
            "LIMIT :limit"
        )
        result = await db.execute(q, {"cursor": str(cursor), "limit": limit_capped})
    else:
        q = text(
            "SELECT * FROM v_transaction_overviews_v1 "
            "ORDER BY created_at DESC "
            "LIMIT :limit"
        )
        result = await db.execute(q, {"limit": limit_capped})

    rows = result.mappings().all()
    data = [s.TransactionOverview.model_validate(dict(r)) for r in rows]
    next_cursor = rows[-1]["transaction_id"] if len(rows) == limit_capped else None
    return s.TransactionListResponse(
        data=data,
        meta={"limit": limit_capped, "cursor": str(next_cursor) if next_cursor else None},
    )


@router.get("/{transaction_id}", response_model=s.TransactionOverview)
async def get_transaction(
    transaction_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.TransactionOverview:
    """Get transaction overview by id (query layer: DB view; RLS-filtered). Logs access decision (02 §5, AUDIT §8.3)."""
    result = await db.execute(
        text("SELECT * FROM v_transaction_overviews_v1 WHERE transaction_id = CAST(:tid AS uuid)"),
        {"tid": str(transaction_id)},
    )
    row = result.mappings().first()
    role = (request.headers.get("X-Role") or "").strip() or ""
    await log_access_decision(
        db,
        actor_id=current_user_id,
        actor_role=role,
        resource_type="transaction",
        resource_id=transaction_id,
        transaction_id=transaction_id if row else None,
        outcome="allow" if row else "deny",
        policy_reference="06-RLS-transactions",
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    if not row:
        await db.commit()
        raise not_found_exception("Transaction", str(transaction_id))
    return s.TransactionOverview.model_validate(dict(row))


def _role_from_request(request: Request) -> str:
    return (request.headers.get("X-Role") or "").strip() or "BUYER"


@router.post("", response_model=s.TransactionOverview, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    body: s.TransactionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
) -> s.TransactionOverview:
    """Create a new transaction in initial state; bind current user as initial party (RLS visibility)."""
    role = _role_from_request(request)
    # BUYER/BUYER_AGENT may only create a transaction in LISTED with listing_id (make-offer flow).
    if role in ("BUYER", "BUYER_AGENT"):
        if body.initial_state != "LISTED":
            raise validation_exception(
                "Buyers can only create transactions in LISTED state (make offer flow)",
                {"initial_state": body.initial_state},
            )
        if not body.listing_id:
            raise validation_exception(
                "listing_id is required when creating an offer transaction",
                {"listing_id": body.listing_id},
            )
        if body.initial_party_role not in ("BUYER", "BUYER_AGENT"):
            raise validation_exception(
                "Buyers must use BUYER or BUYER_AGENT as initial party role",
                {"initial_party_role": body.initial_party_role},
            )
    # Verify initial_state exists
    r = await db.execute(select(m.TransactionState).where(m.TransactionState.state == body.initial_state))
    if not r.scalar_one_or_none():
        raise illegal_transition_exception(
            f"Invalid initial state: {body.initial_state}",
            {"initial_state": body.initial_state},
        )

    # Use DB helper so RLS sees app.user_id/app.organization_id (set in same transaction as INSERT).
    txn_id = uuid4()
    result = await db.execute(
        text(
            "SELECT * FROM insert_transaction_with_party("
            "CAST(:tid AS uuid), CAST(:org AS uuid), CAST(:state AS text), "
            "CAST(:property_id AS uuid), CAST(:listing_id AS uuid), "
            "CAST(:uid AS uuid), CAST(:party_role AS text)"
            ")"
        ),
        {
            "tid": str(txn_id),
            "org": str(body.organization_id),
            "state": body.initial_state,
            "property_id": str(body.property_id) if body.property_id else None,
            "listing_id": str(body.listing_id) if body.listing_id else None,
            "uid": str(current_user_id),
            "party_role": body.initial_party_role,
        },
    )
    row = result.mappings().one()
    return s.TransactionOverview.model_validate(dict(row))


@router.post("/{transaction_id}/transitions", response_model=s.TransactionOverview)
async def transition_transaction(
    transaction_id: UUID,
    body: s.TransitionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.TransactionOverview:
    """Transition transaction state (command). DB transition function is final authority; no direct state update."""
    try:
        await db.execute(
            text(
                "SELECT transition_transaction_state("
                "CAST(:tid AS uuid), CAST(:to_state AS text), :correlation_id"
                ")"
            ),
            {"tid": str(transaction_id), "to_state": body.to_state, "correlation_id": correlation_id or None},
        )
    except Exception as e:
        # Unwrap SQLAlchemy/asyncpg so we see the real DB message (e.g. "Cannot enter FINANCING: title not ordered")
        err = str(e)
        orig = getattr(e, "orig", None) or getattr(e, "__cause__", None)
        if orig:
            err = err + " " + str(orig)
        if "Transaction not found" in err or "not found" in err.lower():
            raise not_found_exception("Transaction", str(transaction_id))
        # Precondition/milestone failures (412) before illegal transition (400)
        if "Precondition failed" in err or "Cannot close transaction" in err or "Cannot enter" in err:
            raise precondition_failed_exception(err.split("\n")[0].strip(), {"transaction_id": str(transaction_id)})
        if "Illegal transition" in err:
            raise illegal_transition_exception(
                err.split("\n")[0],
                {"transaction_id": str(transaction_id), "to_state": body.to_state},
            )
        raise
    await write_audit_event(
        db,
        event_type="STATE_TRANSITION",
        event_category="modification",
        actor_id=current_user_id,
        actor_role=_role_from_request(request),
        resource_type="transaction",
        resource_id=transaction_id,
        transaction_id=transaction_id,
        action="transition",
        outcome="success",
        details={"to_state": body.to_state},
        correlation_id=correlation_id or None,
    )
    result = await db.execute(
        select(m.Transaction).where(m.Transaction.transaction_id == transaction_id)
    )
    txn = result.scalar_one()
    return s.TransactionOverview.model_validate(txn)


@router.post("/{transaction_id}/parties", response_model=s.TransactionPartySummary, status_code=status.HTTP_201_CREATED)
async def add_transaction_party(
    transaction_id: UUID,
    body: s.PartyCreate,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.TransactionPartySummary:
    """Add or update party binding (policy-controlled; audited)."""
    result = await db.execute(
        select(m.Transaction).where(m.Transaction.transaction_id == transaction_id)
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise not_found_exception("Transaction", str(transaction_id))
    party = m.TransactionParty(
        transaction_id=transaction_id,
        user_id=body.user_id,
        organization_id=body.organization_id,
        role=body.role,
    )
    db.add(party)
    await db.flush()
    await db.refresh(party)
    return s.TransactionPartySummary.model_validate(party)

async def _check_milestone_present(db: AsyncSession, transaction_id: UUID, milestone_key: str) -> bool:
    """Return True if the milestone fact exists for this transaction (05/17 alignment)."""
    if milestone_key == "title_ordered":
        r = await db.execute(
            select(title_m.TitleOrder).where(
                title_m.TitleOrder.transaction_id == transaction_id,
                title_m.TitleOrder.status != "CANCELLED",
            )
        )
        return r.scalar_one_or_none() is not None
    if milestone_key == "appraisal_or_waived":
        # Appraisal submitted/completed (case-insensitive per 02-schema) OR waiver exists
        r_app = await db.execute(
            select(insp_m.Appraisal).where(
                insp_m.Appraisal.transaction_id == transaction_id,
                func.lower(insp_m.Appraisal.status).in_(["submitted", "completed"]),
            )
        )
        if r_app.scalar_one_or_none() is not None:
            return True
        r_waiver = await db.execute(
            select(title_m.AppraisalWaiver).where(
                title_m.AppraisalWaiver.transaction_id == transaction_id,
            )
        )
        return r_waiver.scalar_one_or_none() is not None
    if milestone_key == "title_cleared":
        r = await db.execute(
            select(title_m.TitleOrder).where(
                title_m.TitleOrder.transaction_id == transaction_id,
                title_m.TitleOrder.status == "CLEARED",
            )
        )
        if r.scalar_one_or_none() is not None:
            return True
        r2 = await db.execute(
            select(title_m.TitleOrder).where(
                title_m.TitleOrder.transaction_id == transaction_id,
                title_m.TitleOrder.insurance_bound_at.isnot(None),
            )
        )
        return r2.scalar_one_or_none() is not None
    if milestone_key == "funds_confirmed":
        r = await db.execute(
            select(escrow_m.FundingConfirmation).where(
                escrow_m.FundingConfirmation.transaction_id == transaction_id,
                escrow_m.FundingConfirmation.verified == True,
            )
        )
        return r.scalar_one_or_none() is not None
    if milestone_key == "disbursement_recorded":
        r = await db.execute(
            select(escrow_m.Disbursement).where(
                escrow_m.Disbursement.transaction_id == transaction_id,
            )
        )
        return r.scalar_one_or_none() is not None
    if milestone_key == "deed_recorded":
        r = await db.execute(
            select(title_m.DeedRecording).where(
                title_m.DeedRecording.transaction_id == transaction_id,
            )
        )
        return r.scalar_one_or_none() is not None
    if milestone_key == "ownership_transfer_confirmed":
        r = await db.execute(
            select(title_m.OwnershipTransfer).where(
                title_m.OwnershipTransfer.transaction_id == transaction_id,
            )
        )
        return r.scalar_one_or_none() is not None
    return False


# Union type for checklist response (documents + milestones per 05/17)
ChecklistItem = s.DocumentChecklistItem | s.MilestoneChecklistItem


@router.get("/{transaction_id}/document-checklist", response_model=list[ChecklistItem])
async def get_document_checklist(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[ChecklistItem]:
    """Document and milestone checklist for outgoing transitions (05/17: required_documents + preconditions)."""
    result = await db.execute(select(m.Transaction).where(m.Transaction.transaction_id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise not_found_exception("Transaction", str(transaction_id))

    tr = await db.execute(
        select(m.TransactionStateTransition).where(m.TransactionStateTransition.from_state == txn.current_state)
    )
    transitions = tr.scalars().all()
    items: list[ChecklistItem] = []

    for t in transitions:
        # Required documents (05: required_documents per transition)
        for doc_type in (t.required_documents or []):
            dr = await db.execute(
                select(doc_m.Document).where(
                    doc_m.Document.transaction_id == transaction_id,
                    doc_m.Document.document_type == doc_type,
                )
            )
            doc = dr.scalar_one_or_none()
            items.append(
                s.DocumentChecklistItem(
                    document_type=doc_type,
                    required_for_to_state=t.to_state,
                    present=doc is not None,
                    signed=(doc is not None and doc.execution_status == "signed"),
                )
            )
        # Milestone preconditions (05/17: assert_transaction_invariants)
        if t.to_state == "FINANCING":
            for key, label in [
                ("title_ordered", "Title order placed"),
                ("appraisal_or_waived", "Appraisal completed or waived"),
            ]:
                present = await _check_milestone_present(db, transaction_id, key)
                items.append(
                    s.MilestoneChecklistItem(
                        milestone_key=key,
                        label=label,
                        required_for_to_state=t.to_state,
                        present=present,
                    )
                )
        elif t.to_state == "CLEAR_TO_CLOSE":
            present = await _check_milestone_present(db, transaction_id, "title_cleared")
            items.append(
                s.MilestoneChecklistItem(
                    milestone_key="title_cleared",
                    label="Title cleared or insurance bound",
                    required_for_to_state=t.to_state,
                    present=present,
                )
            )
        elif t.to_state == "CLOSED":
            for key, label in [
                ("funds_confirmed", "Funding confirmed"),
                ("disbursement_recorded", "Disbursement recorded"),
                ("deed_recorded", "Deed recorded"),
                ("ownership_transfer_confirmed", "Ownership transfer confirmed"),
            ]:
                present = await _check_milestone_present(db, transaction_id, key)
                items.append(
                    s.MilestoneChecklistItem(
                        milestone_key=key,
                        label=label,
                        required_for_to_state=t.to_state,
                        present=present,
                    )
                )

    return items


@router.get("/{transaction_id}/timeline", response_model=s.TransactionTimeline)
async def get_transaction_timeline(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.TransactionTimeline:
    """Timeline view: state change history + redacted domain events (RLS filtered)."""
    result = await db.execute(select(m.Transaction).where(m.Transaction.transaction_id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise not_found_exception("Transaction", str(transaction_id))

    history_result = await db.execute(
        select(m.TransactionStateHistory)
        .where(m.TransactionStateHistory.transaction_id == transaction_id)
        .order_by(m.TransactionStateHistory.entered_at.asc())
    )
    state_changes = [
        s.TransactionTimelineStateChange.model_validate(h) for h in history_result.scalars().all()
    ]

    events_result = await db.execute(
        select(evt_m.DomainEvent)
        .where(evt_m.DomainEvent.transaction_id == transaction_id)
        .order_by(evt_m.DomainEvent.emitted_at.desc())
        .limit(200)
    )
    events = [evt_s.DomainEventOverview.model_validate(e).model_dump() for e in events_result.scalars().all()]
    return s.TransactionTimeline(state_changes=state_changes, events=events)


# ----- AI advisory (stub; no ai_insights table yet) -----
@router.get("/{transaction_id}/ai/insights", response_model=list[dict])
async def list_transaction_ai_insights(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[dict]:
    """List AI insights for a transaction (stub; visibility_scope filtering when table exists)."""
    result = await db.execute(
        select(m.Transaction).where(m.Transaction.transaction_id == transaction_id)
    )
    if not result.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    return []


# ----- Transaction chat (get or create room) -----
@router.get("/{transaction_id}/chat")
async def get_or_create_transaction_chat(
    transaction_id: UUID,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
):
    """Get or create transaction chat room for this transaction. RLS requires created_by = app.user_id."""
    from realtrust_api.domain.messaging import models as msg_m
    from realtrust_api.domain.messaging import schemas as msg_s
    result = await db.execute(
        select(m.Transaction).where(m.Transaction.transaction_id == transaction_id)
    )
    if not result.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    # Find existing TRANSACTION room for this transaction (prefer earliest by created_at so seed room wins)
    room_result = await db.execute(
        select(msg_m.ChatRoom)
        .where(
            msg_m.ChatRoom.room_type == "TRANSACTION",
            msg_m.ChatRoom.transaction_id == transaction_id,
        )
        .order_by(msg_m.ChatRoom.created_at.asc())
        .limit(1)
    )
    room = room_result.scalar_one_or_none()
    if room:
        return msg_s.ChatRoomOverview.model_validate(room)
    # Create room; created_by must equal app.user_id for RLS INSERT policy.
    room = msg_m.ChatRoom(
        room_type="TRANSACTION",
        transaction_id=transaction_id,
        created_by=current_user_id,
    )
    db.add(room)
    await db.flush()
    db.add(msg_m.ChatRoomMember(room_id=room.room_id, user_id=current_user_id, role="OWNER"))
    await db.flush()
    await db.refresh(room)
    return msg_s.ChatRoomOverview.model_validate(room)