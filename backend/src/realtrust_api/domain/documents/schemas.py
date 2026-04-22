"""Pydantic schemas for document API."""
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class DocumentOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_id: UUID
    transaction_id: UUID
    document_type: str
    execution_status: str
    created_at: datetime
    updated_at: datetime
    view_url: str | None = None  # presigned GET for latest version (only when at least one version exists)


class DocumentCreate(BaseModel):
    document_type: str = Field(..., min_length=1)


class DocumentVersionCreate(BaseModel):
    storage_path: str = Field(..., min_length=1)
    storage_bucket: str = Field(..., min_length=1)
    checksum: str = Field(..., min_length=1)


class DocumentUploadUrlRequest(BaseModel):
    """Optional hints for generating upload URL (filename/content_type)."""
    filename: str | None = None
    content_type: str | None = None


class DocumentUploadUrlResponse(BaseModel):
    """Presigned PUT URL for uploading file; then call POST /documents/{id}/versions with path, bucket, checksum."""
    upload_url: str
    storage_path: str
    storage_bucket: str
    expires_in_seconds: int = 3600


class DocumentVersionOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    version_id: UUID
    document_id: UUID
    storage_path: str
    storage_bucket: str
    checksum: str
    created_at: datetime


class DocumentSignatureCreate(BaseModel):
    signer_id: UUID


class DocumentSignatureOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    signature_id: UUID
    document_version_id: UUID
    signer_id: UUID
    signed_at: datetime
