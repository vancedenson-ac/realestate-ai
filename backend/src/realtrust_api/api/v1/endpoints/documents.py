"""Document endpoints: create, add version, upload URL, lock, sign (09-views-and-apis)."""
import uuid as _uuid
from uuid import UUID
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from realtrust_api.api.deps import get_correlation_id, get_current_user_id, get_db_with_rls
from realtrust_api.core.audit import log_access_decision, write_audit_event
from realtrust_api.core.exceptions import forbidden_by_policy_exception, not_found_exception
from realtrust_api.core.storage import get_presigned_get_url, get_presigned_put_url
from realtrust_api.domain.documents import models as m
from realtrust_api.domain.documents import schemas as s
from realtrust_api.domain.transactions import models as txn_m

router = APIRouter()
EXPIRES_UPLOAD_SECONDS = 3600

@router.get("/transactions/{transaction_id}/documents", response_model=list[s.DocumentOverview])
async def list_transaction_documents(
    transaction_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.DocumentOverview]:
    """List documents for a transaction. view_url is set for documents that have at least one version (for download/view)."""
    tr = await db.execute(
        select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id)
    )
    if not tr.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    r = await db.execute(
        select(m.Document)
        .where(m.Document.transaction_id == transaction_id)
        .options(selectinload(m.Document.versions))
        .order_by(m.Document.created_at.desc())
    )
    rows = r.scalars().all()
    out = []
    for doc in rows:
        base = s.DocumentOverview.model_validate(doc)
        view_url = None
        if doc.versions:
            latest = max(doc.versions, key=lambda v: v.created_at)
            view_url = get_presigned_get_url(latest.storage_bucket, latest.storage_path, expires_in=600)
        out.append(base.model_copy(update={"view_url": view_url}))
    return out


def _role_from_request(request: Request) -> str:
    return (request.headers.get("X-Role") or "").strip() or ""


@router.post("/transactions/{transaction_id}/documents", response_model=s.DocumentOverview, status_code=status.HTTP_201_CREATED)
async def create_document(
    transaction_id: UUID,
    body: s.DocumentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.DocumentOverview:
    """Create document metadata record for a transaction. RLS: caller must be a transaction party (or match state/role for specific doc types)."""
    # Explicit deny: appraisal_report only LENDER/ESCROW_OFFICER/APPRAISER (06; aligns with document_insert_policy)
    if (body.document_type or "").strip().lower() == "appraisal_report":
        role = _role_from_request(request)
        if role not in ("LENDER", "ESCROW_OFFICER", "APPRAISER"):
            raise forbidden_by_policy_exception(
                "Only LENDER, ESCROW_OFFICER, or APPRAISER may create appraisal_report documents.",
                details={"transaction_id": str(transaction_id), "document_type": body.document_type},
            )
    r = await db.execute(select(txn_m.Transaction).where(txn_m.Transaction.transaction_id == transaction_id))
    if not r.scalar_one_or_none():
        raise not_found_exception("Transaction", str(transaction_id))
    doc = m.Document(transaction_id=transaction_id, document_type=body.document_type)
    db.add(doc)
    try:
        await db.flush()
    except (ProgrammingError, IntegrityError) as e:
        msg = str(e).lower()
        if "row-level security" in msg or "rls" in msg or "policy" in msg or (getattr(e, "orig", None) and "insufficientprivilege" in type(e.orig).__name__.lower()):
            raise forbidden_by_policy_exception(
                "Not authorized to add documents to this transaction. Use the same user and organization that created the transaction.",
                details={"transaction_id": str(transaction_id)},
            ) from e
        raise
    await db.refresh(doc)
    return s.DocumentOverview.model_validate(doc)


@router.get("/documents/{document_id}", response_model=s.DocumentOverview)
async def get_document(
    document_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.DocumentOverview:
    """Get document by id (RLS-filtered). view_url set when document has at least one version. Logs access decision (02 §5, AUDIT §8.3)."""
    r = await db.execute(
        select(m.Document).where(m.Document.document_id == document_id).options(selectinload(m.Document.versions))
    )
    doc = r.scalar_one_or_none()
    role = (request.headers.get("X-Role") or "").strip() or ""
    await log_access_decision(
        db,
        actor_id=current_user_id,
        actor_role=role,
        resource_type="document",
        resource_id=document_id,
        transaction_id=doc.transaction_id if doc else None,
        outcome="allow" if doc else "deny",
        policy_reference="06-RLS-documents",
        correlation_id=correlation_id or None,
        actor_user_agent=request.headers.get("User-Agent"),
        actor_ip_address=getattr(getattr(request, "client", None), "host", None),
    )
    if not doc:
        await db.commit()
        raise not_found_exception("Document", str(document_id))
    base = s.DocumentOverview.model_validate(doc)
    view_url = None
    if doc.versions:
        latest = max(doc.versions, key=lambda v: v.created_at)
        view_url = get_presigned_get_url(latest.storage_bucket, latest.storage_path, expires_in=600)
    return base.model_copy(update={"view_url": view_url})


@router.post("/documents/{document_id}/upload-url", response_model=s.DocumentUploadUrlResponse)
async def document_upload_url(
    document_id: UUID,
    body: s.DocumentUploadUrlRequest | None = None,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.DocumentUploadUrlResponse:
    """Get presigned PUT URL for uploading a document file (MinIO/S3). Upload file to URL, then POST /documents/{id}/versions with storage_path, storage_bucket, checksum."""
    r = await db.execute(select(m.Document).where(m.Document.document_id == document_id))
    doc = r.scalar_one_or_none()
    if not doc:
        raise not_found_exception("Document", str(document_id))
    version_id = _uuid.uuid4()
    filename = (body and body.filename) or "file"
    content_type = (body and body.content_type) or "application/octet-stream"
    key = f"documents/{document_id}/{version_id}/{filename}"
    upload_url, storage_bucket, storage_path = get_presigned_put_url(
        key=key, content_type=content_type, expires_in=EXPIRES_UPLOAD_SECONDS
    )
    return s.DocumentUploadUrlResponse(
        upload_url=upload_url,
        storage_path=storage_path,
        storage_bucket=storage_bucket,
        expires_in_seconds=EXPIRES_UPLOAD_SECONDS,
    )


@router.get("/documents/{document_id}/versions", response_model=list[s.DocumentVersionOverview])
async def list_document_versions(
    document_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.DocumentVersionOverview]:
    """List versions for a document (RLS-filtered)."""
    r = await db.execute(select(m.Document).where(m.Document.document_id == document_id))
    doc = r.scalar_one_or_none()
    if not doc:
        raise not_found_exception("Document", str(document_id))
    rv = await db.execute(
        select(m.DocumentVersion)
        .where(m.DocumentVersion.document_id == document_id)
        .order_by(m.DocumentVersion.created_at.desc())
    )
    versions = rv.scalars().all()
    return [s.DocumentVersionOverview.model_validate(v) for v in versions]


@router.post("/documents/{document_id}/versions", response_model=s.DocumentVersionOverview, status_code=status.HTTP_201_CREATED)
async def add_document_version(
    document_id: UUID,
    body: s.DocumentVersionCreate,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.DocumentVersionOverview:
    """Add document version (upload reference; authoritative record is DB metadata + checksum)."""
    r = await db.execute(select(m.Document).where(m.Document.document_id == document_id))
    doc = r.scalar_one_or_none()
    if not doc:
        raise not_found_exception("Document", str(document_id))
    ver = m.DocumentVersion(
        document_id=document_id,
        storage_path=body.storage_path,
        storage_bucket=body.storage_bucket,
        checksum=body.checksum,
    )
    db.add(ver)
    await db.flush()
    await db.refresh(ver)
    return s.DocumentVersionOverview.model_validate(ver)


@router.post("/documents/{document_id}/lock", response_model=s.DocumentOverview)
async def lock_document(
    document_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.DocumentOverview:
    """Lock document (audited; 02 §4 / 17)."""
    r = await db.execute(select(m.Document).where(m.Document.document_id == document_id))
    doc = r.scalar_one_or_none()
    if not doc:
        raise not_found_exception("Document", str(document_id))
    doc.execution_status = "locked"
    await db.flush()
    await write_audit_event(
        db,
        event_type="DOCUMENT_LOCKED",
        event_category="modification",
        actor_id=current_user_id,
        actor_role="",  # RLS session role not passed here; audit still records actor_id
        resource_type="document",
        resource_id=document_id,
        transaction_id=doc.transaction_id,
        action="lock_document",
        outcome="success",
        details={"document_id": str(document_id)},
        correlation_id=correlation_id or None,
    )
    await db.refresh(doc)
    return s.DocumentOverview.model_validate(doc)


@router.post("/documents/{document_id}/signatures", response_model=s.DocumentSignatureOverview, status_code=status.HTTP_201_CREATED)
async def sign_document(
    document_id: UUID,
    body: s.DocumentSignatureCreate,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
    correlation_id: str = Depends(get_correlation_id),
) -> s.DocumentSignatureOverview:
    """Create signature evidence (audited per 02 §4 / 17)."""
    r = await db.execute(select(m.Document).where(m.Document.document_id == document_id))
    doc = r.scalar_one_or_none()
    if not doc:
        raise not_found_exception("Document", str(document_id))
    rv = await db.execute(
        select(m.DocumentVersion).where(m.DocumentVersion.document_id == document_id).order_by(m.DocumentVersion.created_at.desc()).limit(1)
    )
    version = rv.scalar_one_or_none()
    if not version:
        raise not_found_exception("DocumentVersion", "none")
    sig = m.DocumentSignature(
        document_version_id=version.version_id,
        signer_id=body.signer_id,
    )
    db.add(sig)
    # Mark document as signed evidence (used by DB transition preconditions/invariants)
    doc.execution_status = "signed"
    await db.flush()
    await write_audit_event(
        db,
        event_type="DOCUMENT_SIGNED",
        event_category="compliance",
        actor_id=current_user_id,
        actor_role="",
        resource_type="document",
        resource_id=document_id,
        transaction_id=doc.transaction_id,
        action="sign_document",
        outcome="success",
        details={"document_id": str(document_id), "signer_id": str(body.signer_id)},
        correlation_id=correlation_id or None,
    )
    await db.refresh(sig)
    return s.DocumentSignatureOverview.model_validate(sig)
