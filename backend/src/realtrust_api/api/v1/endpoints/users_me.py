"""Users/me endpoints: preferences, recommendations, feedback, saved listings, eligible escrow officers, champagne moments (09-views-and-apis)."""
from datetime import datetime
from uuid import UUID
from decimal import Decimal
from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from realtrust_api.api.deps import get_db_with_rls
from realtrust_api.core.exceptions import not_found_exception
from realtrust_api.api.deps import get_current_user_id
from realtrust_api.domain.matching import models as match_m
from realtrust_api.domain.matching import schemas as s
from realtrust_api.domain.properties import models as prop_m

router = APIRouter()

# Event types that map to stakeholder "champagne moments" (stakeholder-champagne-moments.md).
# Must match emits_event in transaction_state_transitions (03-seed.sql); excludes negative (OfferRejected, TransactionCancelled).
CHAMPAGNE_EVENT_TYPES = (
    "ListingPublished",      # PRE_LISTING → LISTED (Seller/Agent: "You're live")
    "OfferSubmitted",         # LISTED → OFFER_MADE (Buyer/Agent: "Offer sent" / "Offer submitted")
    "ContractExecuted",       # OFFER_MADE → UNDER_CONTRACT (Buyer, Seller, Agent, Escrow: "Contract executed")
    "EscrowOpened",           # UNDER_CONTRACT → DUE_DILIGENCE (Escrow: "Escrow opened")
    "DueDiligenceCompleted",  # DUE_DILIGENCE → FINANCING (Agent etc.: title/appraisal done, "Due diligence complete")
    "LoanApproved",           # FINANCING → CLEAR_TO_CLOSE (Buyer, Lender, Agent: "Clear to close")
    "TransactionClosed",      # CLEAR_TO_CLOSE → CLOSED (Buyer, Seller, Agent, Escrow: "Close of Escrow")
)


class ChampagneMomentOverview(BaseModel):
    """Champagne moment derived from domain_events; enriched with property address and amount for in-app toast."""

    event_id: UUID
    event_type: str
    emitted_at: datetime
    transaction_id: UUID
    property_address: str | None = None
    amount: float | None = None
    title: str = "Champagne Moment!"
    message: str = ""


class EligibleEscrowOfficerResponse(BaseModel):
    """User eligible to be assigned as escrow officer (same org, role ESCROW_OFFICER)."""

    user_id: UUID
    full_name: str | None
    email: str


@router.get("/preferences", response_model=list[s.PreferenceOverview])
async def list_preferences(
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.PreferenceOverview]:
    """List current user's saved preferences (active only by default)."""
    q = (
        select(match_m.BuyerPreference)
        .where(match_m.BuyerPreference.user_id == current_user_id)
        .where(match_m.BuyerPreference.is_active == True)
        .order_by(match_m.BuyerPreference.updated_at.desc())
    )
    result = await db.execute(q)
    rows = result.scalars().all()
    return [s.PreferenceOverview.model_validate(p) for p in rows]


@router.get("/preferences/{preference_id}", response_model=s.PreferenceOverview)
async def get_preference(
    preference_id: UUID,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.PreferenceOverview:
    """Get preference by id (must belong to current user)."""
    result = await db.execute(
        select(match_m.BuyerPreference).where(
            match_m.BuyerPreference.preference_id == preference_id,
            match_m.BuyerPreference.user_id == current_user_id,
        )
    )
    pref = result.scalar_one_or_none()
    if not pref:
        raise not_found_exception("Preference", str(preference_id))
    return s.PreferenceOverview.model_validate(pref)


@router.post("/preferences", response_model=s.PreferenceOverview, status_code=status.HTTP_201_CREATED)
async def create_preference(
    body: s.PreferenceCreate,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.PreferenceOverview:
    """Create a new buyer preference for current user."""
    pref = match_m.BuyerPreference(
        user_id=current_user_id,
        price_min=body.price_min,
        price_max=body.price_max,
        bedrooms_min=body.bedrooms_min,
        bedrooms_max=body.bedrooms_max,
        preferred_states=body.preferred_states,
        preferred_cities=body.preferred_cities,
        preferred_zip_codes=body.preferred_zip_codes,
        property_types=body.property_types,
        min_sqft=body.min_sqft,
        max_sqft=body.max_sqft,
        lifestyle_description=body.lifestyle_description,
        notification_frequency=body.notification_frequency,
    )
    db.add(pref)
    await db.flush()
    await db.refresh(pref)
    return s.PreferenceOverview.model_validate(pref)


@router.patch("/preferences/{preference_id}", response_model=s.PreferenceOverview)
async def update_preference(
    preference_id: UUID,
    body: s.PreferenceUpdate,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.PreferenceOverview:
    """Update preference (partial)."""
    result = await db.execute(
        select(match_m.BuyerPreference).where(
            match_m.BuyerPreference.preference_id == preference_id,
            match_m.BuyerPreference.user_id == current_user_id,
        )
    )
    pref = result.scalar_one_or_none()
    if not pref:
        raise not_found_exception("Preference", str(preference_id))
    update_data = body.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(pref, k, v)
    await db.flush()
    await db.refresh(pref)
    return s.PreferenceOverview.model_validate(pref)


@router.delete("/preferences/{preference_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preference(
    preference_id: UUID,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> None:
    """Deactivate preference (soft delete)."""
    result = await db.execute(
        select(match_m.BuyerPreference).where(
            match_m.BuyerPreference.preference_id == preference_id,
            match_m.BuyerPreference.user_id == current_user_id,
        )
    )
    pref = result.scalar_one_or_none()
    if not pref:
        raise not_found_exception("Preference", str(preference_id))
    pref.is_active = False
    await db.flush()


@router.get("/recommendations", response_model=s.RecommendationsResponse)
async def list_recommendations(
    preference_id: UUID | None = None,
    min_score: float = 0.0,
    limit: int = 20,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.RecommendationsResponse:
    """List matched listings for current user (optionally filtered by preference_id and min_score)."""
    q = (
        select(match_m.PropertyMatch)
        .where(match_m.PropertyMatch.user_id == current_user_id)
        .where(match_m.PropertyMatch.match_score >= min_score)
        .order_by(match_m.PropertyMatch.match_score.desc())
        .limit(limit + 1)
    )
    if preference_id is not None:
        q = q.where(match_m.PropertyMatch.preference_id == preference_id)
    result = await db.execute(q)
    rows = result.scalars().all()
    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]
    items = []
    for match in rows:
        # Load listing and property for this match
        listing_result = await db.execute(
            select(prop_m.Listing, prop_m.Property).join(
                prop_m.Property, prop_m.Listing.property_id == prop_m.Property.property_id
            ).where(prop_m.Listing.listing_id == match.listing_id)
        )
        row = listing_result.one_or_none()
        if not row:
            continue
        listing, prop = row
        items.append(
            s.RecommendationItem(
                match_id=match.match_id,
                listing=s.ListingDetailsShort(
                    listing_id=listing.listing_id,
                    list_price=listing.list_price,
                    status=listing.status,
                    days_on_market=listing.days_on_market,
                ),
                property=s.PropertyDetailsShort(
                    property_id=prop.property_id,
                    address_line_1=prop.address_line_1,
                    city=prop.city,
                    state_province=prop.state_province,
                    postal_code=prop.postal_code,
                    bedrooms=prop.bedrooms,
                    bathrooms_full=prop.bathrooms_full,
                    living_area_sqft=prop.living_area_sqft,
                    property_type=prop.property_type,
                ),
                match_score=match.match_score,
                match_explanation=match.ai_explanation,
                score_breakdown=match.score_breakdown or {},
                recommended_at=match.computed_at,
            )
        )
    return s.RecommendationsResponse(
        recommendations=items,
        meta={"limit": limit, "cursor": None},
    )


@router.get("/saved-listings", response_model=list[s.SavedListingOverview])
async def list_saved_listings(
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.SavedListingOverview]:
    """List current user's saved listings (with listing + property details)."""
    from realtrust_api.domain.matching.models import SavedListing

    q = (
        select(SavedListing, prop_m.Listing, prop_m.Property)
        .join(prop_m.Listing, SavedListing.listing_id == prop_m.Listing.listing_id)
        .join(prop_m.Property, prop_m.Listing.property_id == prop_m.Property.property_id)
        .where(SavedListing.user_id == current_user_id)
        .order_by(SavedListing.saved_at.desc())
    )
    result = await db.execute(q)
    rows = result.all()
    return [
        s.SavedListingOverview(
            listing_id=listing.listing_id,
            property_id=prop.property_id,
            address_line_1=prop.address_line_1,
            city=prop.city,
            state_province=prop.state_province,
            postal_code=prop.postal_code,
            list_price=listing.list_price,
            listing_status=listing.status,
            saved_at=saved.saved_at,
        )
        for saved, listing, prop in rows
    ]


@router.post("/saved-listings", response_model=s.SavedListingOverview, status_code=status.HTTP_201_CREATED)
async def save_listing(
    body: s.SavedListingCreate,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.SavedListingOverview:
    """Save a listing for the current user (listing must exist and be visible to user)."""
    from realtrust_api.domain.matching.models import SavedListing

    listing_result = await db.execute(
        select(prop_m.Listing, prop_m.Property)
        .join(prop_m.Property, prop_m.Listing.property_id == prop_m.Property.property_id)
        .where(prop_m.Listing.listing_id == body.listing_id)
    )
    row = listing_result.one_or_none()
    if not row:
        raise not_found_exception("Listing", str(body.listing_id))
    listing, prop = row
    existing_saved = await db.execute(
        select(SavedListing).where(
            SavedListing.user_id == current_user_id,
            SavedListing.listing_id == body.listing_id,
        )
    )
    saved = existing_saved.scalar_one_or_none()
    if not saved:
        saved = SavedListing(user_id=current_user_id, listing_id=body.listing_id)
        db.add(saved)
        await db.flush()
        await db.refresh(saved)
    return s.SavedListingOverview(
        listing_id=listing.listing_id,
        property_id=prop.property_id,
        address_line_1=prop.address_line_1,
        city=prop.city,
        state_province=prop.state_province,
        postal_code=prop.postal_code,
        list_price=listing.list_price,
        listing_status=listing.status,
        saved_at=saved.saved_at,
    )


@router.delete("/saved-listings/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unsave_listing(
    listing_id: UUID,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> None:
    """Remove a listing from current user's saved list."""
    from sqlalchemy import delete
    from realtrust_api.domain.matching.models import SavedListing

    await db.execute(
        delete(SavedListing).where(
            SavedListing.user_id == current_user_id,
            SavedListing.listing_id == listing_id,
        )
    )
    await db.flush()


@router.post("/recommendations/{match_id}/feedback")
async def submit_recommendation_feedback(
    match_id: UUID,
    body: s.FeedbackBody,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> dict:
    """Record user feedback (LIKED, DISLIKED, SAVED, CONTACTED) for a recommendation."""
    from datetime import datetime, timezone
    result = await db.execute(
        select(match_m.PropertyMatch).where(
            match_m.PropertyMatch.match_id == match_id,
            match_m.PropertyMatch.user_id == current_user_id,
        )
    )
    match = result.scalar_one_or_none()
    if not match:
        raise not_found_exception("PropertyMatch", str(match_id))
    match.user_feedback = body.feedback
    match.feedback_at = datetime.now(timezone.utc)
    await db.flush()
    return {"match_id": str(match_id), "feedback": body.feedback}


@router.get("/eligible-escrow-officers", response_model=list[EligibleEscrowOfficerResponse])
async def list_eligible_escrow_officers(
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[EligibleEscrowOfficerResponse]:
    """List users in the current organization with role ESCROW_OFFICER (for escrow assignment picker). RLS restricts to same org."""
    result = await db.execute(
        text("""
            SELECT u.user_id, u.full_name, u.email
            FROM organization_members om
            JOIN users u ON u.user_id = om.user_id
            WHERE om.role = 'ESCROW_OFFICER'
            ORDER BY u.full_name NULLS LAST, u.email
        """)
    )
    rows = result.mappings().all()
    return [
        EligibleEscrowOfficerResponse(
            user_id=r["user_id"],
            full_name=r["full_name"],
            email=r["email"],
        )
        for r in rows
    ]


def _format_amount(amount: Decimal | float | None) -> str:
    """Format amount for display (e.g. 1500000 -> $1.5M)."""
    if amount is None:
        return ""
    n = float(amount)
    if n >= 1_000_000:
        return f"${n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"${n / 1_000:.1f}K"
    return f"${n:,.0f}"


def _champagne_title_and_message(event_type: str, property_address: str | None, amount: float | None) -> tuple[str, str]:
    """Build notification title and message for champagne moment (stakeholder-champagne-moments.md).
    Copy aligned with Notification title / Message columns; one line per event type (role-tailoring can be added later).
    """
    # Shared suffix for property/amount when present
    suffix_parts: list[str] = []
    if property_address:
        suffix_parts.append(property_address)
    if amount is not None:
        suffix_parts.append(_format_amount(amount))
    suffix = " — " + " - ".join(suffix_parts) if suffix_parts else ""

    if event_type == "TransactionClosed":
        title = "Champagne Moment!"
        mid: list[str] = []
        if property_address:
            mid.append(property_address)
        if amount is not None:
            mid.append(_format_amount(amount))
        mid.append("Congratulations!")
        message = "Escrow Closed" + (": " + " - ".join(mid) if mid else "")
        return title, message
    if event_type == "ListingPublished":
        title = "You're live"
        message = "Your listing is live on the market. View performance on your dashboard." + suffix
        return title, message
    if event_type == "OfferSubmitted":
        title = "Offer sent"
        message = "Your offer has been submitted to the seller. We'll notify you when they respond." + suffix
        return title, message
    if event_type == "ContractExecuted":
        title = "Contract executed"
        message = "Everyone has signed. You're under contract. Next: earnest money and escrow." + suffix
        return title, message
    if event_type == "EscrowOpened":
        title = "Escrow opened"
        message = "Escrow is open. Awaiting earnest money and instructions." + suffix
        return title, message
    if event_type == "DueDiligenceCompleted":
        title = "Due diligence complete"
        message = "Title and appraisal in. Moving to financing." + suffix
        return title, message
    if event_type == "LoanApproved":
        title = "Clear to close"
        message = "Your loan is approved. You're on track for closing." + suffix
        return title, message
    title = "Champagne Moment!"
    message = event_type.replace("_", " ").title() + suffix
    return title, message


@router.get("/champagne-moments", response_model=list[ChampagneMomentOverview])
async def list_champagne_moments(
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
    limit: int = Query(20, le=50),
) -> list[ChampagneMomentOverview]:
    """List champagne moments (domain events) for the current user. RLS restricts to events for transactions where user is a party. Used for in-app celebratory toasts."""
    result = await db.execute(
        text("""
            SELECT
                de.event_id,
                de.event_type,
                de.emitted_at,
                de.transaction_id,
                TRIM(CONCAT_WS(', ',
                    NULLIF(TRIM(p.address_line_1), ''),
                    NULLIF(TRIM(p.city), ''),
                    NULLIF(TRIM(p.state_province), '')
                )) AS property_address,
                (COALESCE(t.offer_price, l.list_price))::float AS amount
            FROM domain_events de
            INNER JOIN transaction_parties tp ON tp.transaction_id = de.transaction_id AND tp.user_id = :user_id
            LEFT JOIN transactions t ON t.transaction_id = de.transaction_id
            LEFT JOIN listings l ON l.listing_id = t.listing_id
            LEFT JOIN properties p ON p.property_id = COALESCE(t.property_id, l.property_id)
            WHERE de.event_type IN (""" + ", ".join(repr(e) for e in CHAMPAGNE_EVENT_TYPES) + """)
            ORDER BY de.emitted_at DESC
            LIMIT :limit
        """),
        {"user_id": str(current_user_id), "limit": limit},
    )
    rows = result.mappings().all()
    out = []
    for r in rows:
        addr = r["property_address"] if r["property_address"] else None
        amount_val = float(r["amount"]) if r["amount"] is not None else None
        title, message = _champagne_title_and_message(r["event_type"], addr, amount_val)
        out.append(
            ChampagneMomentOverview(
                event_id=r["event_id"],
                event_type=r["event_type"],
                emitted_at=r["emitted_at"],
                transaction_id=r["transaction_id"],
                property_address=addr,
                amount=amount_val,
                title=title,
                message=message,
            )
        )
    return out
