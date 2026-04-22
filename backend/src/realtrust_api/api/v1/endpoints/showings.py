"""Showing endpoints: schedule/list/update (09-views-and-apis)."""

from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from realtrust_api.api.deps import get_current_user_id, get_db_with_rls
from realtrust_api.core.exceptions import forbidden_by_policy_exception, not_found_exception
from realtrust_api.domain.properties import models as prop_m
from realtrust_api.domain.showings import models as m
from realtrust_api.domain.showings import schemas as s

router = APIRouter()


@router.get("/listings/{listing_id}/showings", response_model=list[s.ShowingOverview])
async def list_showings(
    listing_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.ShowingOverview]:
    lr = await db.execute(select(prop_m.Listing).where(prop_m.Listing.listing_id == listing_id))
    if not lr.scalar_one_or_none():
        raise not_found_exception("Listing", str(listing_id))
    result = await db.execute(
        select(m.Showing).where(m.Showing.listing_id == listing_id).order_by(m.Showing.scheduled_start_at.desc())
    )
    rows = result.scalars().all()
    return [s.ShowingOverview.model_validate(x) for x in rows]


@router.post(
    "/listings/{listing_id}/showings",
    response_model=s.ShowingOverview,
    status_code=status.HTTP_201_CREATED,
)
async def schedule_showing(
    listing_id: UUID,
    body: s.ShowingCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
) -> s.ShowingOverview:
    lr = await db.execute(select(prop_m.Listing).where(prop_m.Listing.listing_id == listing_id))
    if not lr.scalar_one_or_none():
        raise not_found_exception("Listing", str(listing_id))
    showing = m.Showing(
        listing_id=listing_id,
        scheduled_start_at=body.scheduled_start_at,
        scheduled_end_at=body.scheduled_end_at,
        status="SCHEDULED",
        showing_type=body.showing_type if body.showing_type in ("PRIVATE", "OPEN_HOUSE") else "PRIVATE",
        requested_by_user_id=body.requested_by_user_id,
        created_by_user_id=current_user_id,
        notes=body.notes,
    )
    db.add(showing)
    await db.flush()
    await db.refresh(showing)
    return s.ShowingOverview.model_validate(showing)


@router.patch("/showings/{showing_id}", response_model=s.ShowingOverview)
async def update_showing(
    showing_id: UUID,
    body: s.ShowingUpdate,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.ShowingOverview:
    r = await db.execute(select(m.Showing).where(m.Showing.showing_id == showing_id))
    showing = r.scalar_one_or_none()
    if not showing:
        raise not_found_exception("Showing", str(showing_id))
    update_data = body.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(showing, k, v)
    await db.flush()
    await db.refresh(showing)
    return s.ShowingOverview.model_validate(showing)


@router.get("/showings/{showing_id}/feedback", response_model=list[s.ShowingFeedbackOverview])
async def list_showing_feedback(
    showing_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.ShowingFeedbackOverview]:
    """List feedback for a showing (RLS-filtered)."""
    r = await db.execute(select(m.Showing).where(m.Showing.showing_id == showing_id))
    if not r.scalar_one_or_none():
        raise not_found_exception("Showing", str(showing_id))
    result = await db.execute(
        select(m.ShowingFeedback)
        .where(m.ShowingFeedback.showing_id == showing_id)
        .order_by(m.ShowingFeedback.created_at.desc())
    )
    rows = result.scalars().all()
    return [s.ShowingFeedbackOverview.model_validate(x) for x in rows]


@router.post(
    "/showings/{showing_id}/feedback",
    response_model=s.ShowingFeedbackOverview,
    status_code=status.HTTP_201_CREATED,
)
async def create_showing_feedback(
    showing_id: UUID,
    body: s.ShowingFeedbackCreate,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
) -> s.ShowingFeedbackOverview:
    """Add feedback for a showing (agent/seller; RLS enforces listing agent or broker)."""
    r = await db.execute(select(m.Showing).where(m.Showing.showing_id == showing_id))
    showing = r.scalar_one_or_none()
    if not showing:
        raise not_found_exception("Showing", str(showing_id))
    feedback = m.ShowingFeedback(
        listing_id=showing.listing_id,
        showing_id=showing_id,
        from_user_id=current_user_id,
        rating=body.rating if body.rating in ("POSITIVE", "NEUTRAL", "NEGATIVE", "NO_SHOW") else None,
        notes=body.notes,
    )
    db.add(feedback)
    try:
        await db.flush()
    except (ProgrammingError, IntegrityError) as e:
        msg = str(e).lower()
        orig_name = ""
        if getattr(e, "orig", None):
            orig_name = type(e.orig).__name__.lower()
        if (
            "row-level security" in msg
            or "rls" in msg
            or "policy" in msg
            or "insufficientprivilege" in orig_name
        ):
            raise forbidden_by_policy_exception(
                "Only the listing agent or broker can add showing feedback.",
                details={"showing_id": str(showing_id)},
            ) from e
        raise
    await db.refresh(feedback)
    return s.ShowingFeedbackOverview.model_validate(feedback)

