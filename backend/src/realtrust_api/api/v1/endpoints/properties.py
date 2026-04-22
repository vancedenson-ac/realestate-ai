"""Property endpoints: list, get, create, update, search, images (09-views-and-apis)."""
from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy import select, and_, func, case, text
from sqlalchemy.ext.asyncio import AsyncSession

from realtrust_api.api.deps import get_db_with_rls
from realtrust_api.api.deps import get_current_user_id
from realtrust_api.core.exceptions import not_found_exception
from realtrust_api.domain.properties import models as m
from realtrust_api.domain.properties import schemas as s

router = APIRouter()


async def _cover_image_urls_for_properties(
    db: AsyncSession, property_ids: list[UUID]
) -> dict[UUID, str]:
    """Return property_id -> presigned view URL for primary (or first) completed image."""
    from realtrust_api.core.storage import get_presigned_get_url

    if not property_ids:
        return {}
    q = (
        select(m.PropertyImage)
        .where(
            m.PropertyImage.property_id.in_(property_ids),
            m.PropertyImage.file_size_bytes > 0,
            m.PropertyImage.checksum != "pending",
        )
        .order_by(
            m.PropertyImage.is_primary.desc(),
            m.PropertyImage.display_order.asc(),
            m.PropertyImage.uploaded_at.asc(),
        )
    )
    result = await db.execute(q)
    images = result.scalars().all()
    seen: set[UUID] = set()
    out: dict[UUID, str] = {}
    for img in images:
        if img.property_id not in seen:
            seen.add(img.property_id)
            url = get_presigned_get_url(img.storage_bucket, img.storage_path, expires_in=600)
            if url:
                out[img.property_id] = url
    return out


@router.get("", response_model=list[s.PropertyOverview])
async def list_properties(
    limit: int = 20,
    offset: int = 0,
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.PropertyOverview]:
    """List properties (RLS will scope when auth is enabled)."""
    q = select(m.Property).order_by(m.Property.created_at.desc()).limit(min(limit, 100)).offset(offset)
    if status_filter:
        q = q.where(m.Property.status == status_filter)
    result = await db.execute(q)
    rows = result.scalars().all()
    property_ids = [p.property_id for p in rows]
    cover_urls = await _cover_image_urls_for_properties(db, property_ids)
    return [
        s.PropertyOverview.model_validate(p).model_copy(update={"cover_image_url": cover_urls.get(p.property_id)})
        for p in rows
    ]


@router.get("/{property_id}", response_model=s.PropertyOverview)
async def get_property(
    property_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.PropertyOverview:
    """Get property by id (RLS-filtered)."""
    result = await db.execute(select(m.Property).where(m.Property.property_id == property_id))
    prop = result.scalar_one_or_none()
    if not prop:
        raise not_found_exception("Property", str(property_id))
    cover_urls = await _cover_image_urls_for_properties(db, [property_id])
    return s.PropertyOverview.model_validate(prop).model_copy(
        update={"cover_image_url": cover_urls.get(property_id)}
    )


@router.post("", response_model=s.PropertyOverview, status_code=status.HTTP_201_CREATED)
async def create_property(
    body: s.PropertyCreate,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.PropertyOverview:
    """Create property (agents; must be associated with organization when auth is added)."""
    prop = m.Property(
        address_line_1=body.address_line_1,
        address_line_2=body.address_line_2,
        city=body.city,
        state_province=body.state_province,
        postal_code=body.postal_code,
        country=body.country,
        latitude=body.latitude,
        longitude=body.longitude,
        property_type=body.property_type,
        year_built=body.year_built,
        living_area_sqft=body.living_area_sqft,
        bedrooms=body.bedrooms,
        bathrooms_full=body.bathrooms_full,
        data_source=body.data_source,
    )
    db.add(prop)
    await db.flush()
    await db.refresh(prop)
    cover_urls = await _cover_image_urls_for_properties(db, [prop.property_id])
    return s.PropertyOverview.model_validate(prop).model_copy(
        update={"cover_image_url": cover_urls.get(prop.property_id)}
    )


@router.patch("/{property_id}", response_model=s.PropertyOverview)
async def update_property(
    property_id: UUID,
    body: s.PropertyUpdate,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.PropertyOverview:
    """Update property attributes (partial)."""
    result = await db.execute(select(m.Property).where(m.Property.property_id == property_id))
    prop = result.scalar_one_or_none()
    if not prop:
        raise not_found_exception("Property", str(property_id))
    update_data = body.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(prop, k, v)
    await db.flush()
    await db.refresh(prop)
    cover_urls = await _cover_image_urls_for_properties(db, [prop.property_id])
    return s.PropertyOverview.model_validate(prop).model_copy(
        update={"cover_image_url": cover_urls.get(prop.property_id)}
    )


# ----- Search (POST body per 09-views-and-apis) -----
@router.post("/search", response_model=s.PropertySearchResponse)
async def search_properties(
    body: s.PropertySearchRequest,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.PropertySearchResponse:
    """Search properties/listings by location, filters, sort, pagination."""
    pag = body.pagination or s.PropertySearchPagination()
    limit = min(pag.limit, 100)
    sort = body.sort or s.PropertySearchSort()
    direction = sort.direction.lower() == "desc"
    order_col = getattr(m.Listing, sort.field, m.Listing.list_price)
    if direction:
        order_col = order_col.desc()
    q = (
        select(m.Listing, m.Property)
        .join(m.Property, m.Listing.property_id == m.Property.property_id)
        .where(m.Listing.status == "ACTIVE")
        .order_by(order_col)
        .limit(limit + 1)
    )
    if body.location:
        if body.location.city:
            q = q.where(m.Property.city.ilike(f"%{body.location.city}%"))
        if body.location.state:
            q = q.where(m.Property.state_province == body.location.state)
    if body.filters:
        if body.filters.price_min is not None:
            q = q.where(m.Listing.list_price >= body.filters.price_min)
        if body.filters.price_max is not None:
            q = q.where(m.Listing.list_price <= body.filters.price_max)
        if body.filters.bedrooms_min is not None:
            q = q.where(m.Property.bedrooms >= body.filters.bedrooms_min)
        if body.filters.property_types:
            q = q.where(m.Property.property_type.in_(body.filters.property_types))
    if pag.cursor:
        try:
            cursor_uuid = UUID(pag.cursor)
            if sort.direction.lower() == "desc":
                q = q.where(m.Listing.listing_id < cursor_uuid)
            else:
                q = q.where(m.Listing.listing_id > cursor_uuid)
        except ValueError:
            pass
    result = await db.execute(q)
    rows = result.all()
    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]
    property_ids = [r[1].property_id for r in rows]
    image_stats: dict[UUID, tuple[int, str | None]] = {}
    if property_ids:
        sub = (
            select(
                m.PropertyImage.property_id,
                func.count(m.PropertyImage.image_id).label("cnt"),
                func.max(case((m.PropertyImage.is_primary == True, m.PropertyImage.storage_path))).label("primary_path"),
            )
            .where(m.PropertyImage.property_id.in_(property_ids))
            .group_by(m.PropertyImage.property_id)
        )
        img_result = await db.execute(sub)
        for pid, cnt, path in img_result.all():
            image_stats[pid] = (cnt, path)
    items = []
    for listing, prop in rows:
        cnt, primary_path = image_stats.get(prop.property_id, (0, None))
        price_per_sqft = (
            (listing.list_price / prop.living_area_sqft) if prop.living_area_sqft and prop.living_area_sqft > 0 else None
        )
        items.append(
            s.PropertySearchResultItem(
                listing_id=listing.listing_id,
                property_id=prop.property_id,
                address_line_1=prop.address_line_1,
                city=prop.city,
                state_province=prop.state_province,
                postal_code=prop.postal_code,
                list_price=listing.list_price,
                price_per_sqft=price_per_sqft,
                bedrooms=prop.bedrooms,
                bathrooms_full=prop.bathrooms_full,
                living_area_sqft=prop.living_area_sqft,
                property_type=prop.property_type,
                year_built=prop.year_built,
                days_on_market=listing.days_on_market,
                listing_status=listing.status,
                primary_image_url=primary_path,
                image_count=cnt,
            )
        )
    next_cursor = str(rows[-1][0].listing_id) if rows and has_more else None
    return s.PropertySearchResponse(
        data=items,
        meta={"limit": limit, "cursor": next_cursor},
    )


# ----- Property images -----
@router.post("/{property_id}/images/upload", response_model=s.PropertyImageUploadUrlResponse)
async def property_image_upload_url(
    property_id: UUID,
    body: s.PropertyImageUploadUrlRequest | None = None,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.PropertyImageUploadUrlResponse:
    """Get presigned PUT URL for property image (MinIO/S3 or stub). Create image row with path; client uploads then may PATCH file_size_bytes and checksum."""
    from realtrust_api.core.storage import get_presigned_put_url

    result = await db.execute(select(m.Property).where(m.Property.property_id == property_id))
    prop = result.scalar_one_or_none()
    if not prop:
        raise not_found_exception("Property", str(property_id))
    import uuid as _uuid
    image_id = _uuid.uuid4()
    filename = (body and body.filename) or "image.jpg"
    content_type = (body and body.content_type) or "image/jpeg"
    key = f"properties/{property_id}/images/{image_id}/{filename}"
    upload_url, storage_bucket, storage_path = get_presigned_put_url(
        key=key, content_type=content_type, expires_in=3600
    )
    img = m.PropertyImage(
        image_id=image_id,
        property_id=property_id,
        uploaded_by=current_user_id,
        storage_path=storage_path,
        storage_bucket=storage_bucket,
        file_size_bytes=0,
        mime_type=content_type,
        checksum="pending",
    )
    db.add(img)
    await db.flush()
    return s.PropertyImageUploadUrlResponse(
        upload_url=upload_url,
        image_id=image_id,
        storage_path=storage_path,
        storage_bucket=storage_bucket,
        expires_in_seconds=3600,
    )


@router.get("/{property_id}/images", response_model=list[s.PropertyImageOverview])
async def list_property_images(
    property_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.PropertyImageOverview]:
    """List images for a property. view_url is set for completed uploads so the client can display the image."""
    from realtrust_api.core.storage import get_presigned_get_url

    result = await db.execute(
        select(m.PropertyImage).where(m.PropertyImage.property_id == property_id).order_by(m.PropertyImage.display_order, m.PropertyImage.uploaded_at)
    )
    images = result.scalars().all()
    out = []
    for img in images:
        base = s.PropertyImageOverview.model_validate(img)
        view_url = None
        if img.file_size_bytes and img.checksum and img.checksum != "pending":
            view_url = get_presigned_get_url(img.storage_bucket, img.storage_path, expires_in=600)
        out.append(base.model_copy(update={"view_url": view_url}))
    return out


@router.patch("/{property_id}/images/{image_id}", response_model=s.PropertyImageOverview)
async def update_property_image(
    property_id: UUID,
    image_id: UUID,
    body: s.PropertyImageUpdate,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.PropertyImageOverview:
    """Update image caption, order, or primary flag."""
    result = await db.execute(
        select(m.PropertyImage).where(
            and_(m.PropertyImage.property_id == property_id, m.PropertyImage.image_id == image_id)
        )
    )
    img = result.scalar_one_or_none()
    if not img:
        raise not_found_exception("PropertyImage", str(image_id))
    update_data = body.model_dump(exclude_unset=True)
    if update_data.get("is_primary") is True:
        await db.execute(
            m.PropertyImage.__table__.update()
            .where(m.PropertyImage.property_id == property_id)
            .values(is_primary=False)
        )
    for k, v in update_data.items():
        setattr(img, k, v)
    await db.flush()
    await db.refresh(img)
    overview = s.PropertyImageOverview.model_validate(img)
    view_url = None
    if img.file_size_bytes and img.checksum and img.checksum != "pending":
        from realtrust_api.core.storage import get_presigned_get_url
        view_url = get_presigned_get_url(img.storage_bucket, img.storage_path, expires_in=600)
    return overview.model_copy(update={"view_url": view_url})


@router.delete("/{property_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_property_image(
    property_id: UUID,
    image_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> None:
    """Remove image from property."""
    result = await db.execute(
        select(m.PropertyImage).where(
            and_(m.PropertyImage.property_id == property_id, m.PropertyImage.image_id == image_id)
        )
    )
    img = result.scalar_one_or_none()
    if not img:
        raise not_found_exception("PropertyImage", str(image_id))
    await db.delete(img)
    await db.flush()


# ----- Search by image (stub) -----
@router.post("/search/by-image", response_model=s.PropertySearchResponse)
async def search_properties_by_image(
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.PropertySearchResponse:
    """Find visually similar properties by image (stub; embedding similarity when AI is wired)."""
    return s.PropertySearchResponse(data=[], meta={"limit": 20, "cursor": None})
