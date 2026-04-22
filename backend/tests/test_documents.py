"""Document endpoints: upload URL, add version (media/storage)."""
import pytest
from httpx import AsyncClient

from tests.conftest import error_code

TX_PRE_LISTING = "c0000001-0000-0000-0000-000000000002"
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"


@pytest.mark.asyncio
async def test_create_document_pre_qualification_letter(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /transactions/{id}/documents with document_type pre_qualification_letter returns 201."""
    r = await client_as_alice.post(
        f"{api_base}/transactions/{TX_PRE_LISTING}/documents",
        json={"document_type": "pre_qualification_letter"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["document_type"] == "pre_qualification_letter"
    assert data["transaction_id"] == TX_PRE_LISTING


@pytest.mark.asyncio
async def test_document_upload_url_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /documents/{id}/upload-url returns 200 with upload_url, storage_path, storage_bucket."""
    create = await client_as_alice.post(
        f"{api_base}/transactions/{TX_PRE_LISTING}/documents",
        json={"document_type": "purchase_agreement"},
    )
    assert create.status_code == 201
    document_id = create.json()["document_id"]
    r = await client_as_alice.post(
        f"{api_base}/documents/{document_id}/upload-url",
        json={"filename": "agreement.pdf", "content_type": "application/pdf"},
    )
    assert r.status_code == 200
    data = r.json()
    assert "upload_url" in data
    assert "storage_path" in data
    assert "storage_bucket" in data
    assert data.get("expires_in_seconds") == 3600
    assert document_id in data["storage_path"]
    assert data["storage_bucket"]


@pytest.mark.asyncio
async def test_document_upload_url_empty_body(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /documents/{id}/upload-url with no body returns 200 (default filename/content_type)."""
    create = await client_as_alice.post(
        f"{api_base}/transactions/{TX_PRE_LISTING}/documents",
        json={"document_type": "disclosure"},
    )
    assert create.status_code == 201
    document_id = create.json()["document_id"]
    r = await client_as_alice.post(f"{api_base}/documents/{document_id}/upload-url")
    assert r.status_code == 200
    data = r.json()
    assert "upload_url" in data and "storage_path" in data and "storage_bucket" in data


@pytest.mark.asyncio
async def test_document_upload_url_not_found(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /documents/{id}/upload-url returns 404 for unknown document."""
    r = await client_as_alice.post(
        f"{api_base}/documents/{NONEXISTENT_UUID}/upload-url",
        json={"filename": "x.pdf"},
    )
    assert r.status_code == 404
    assert error_code(r.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_document_upload_then_add_version(client_as_alice: AsyncClient, api_base: str) -> None:
    """Flow: create document -> get upload-url -> add version with returned path/bucket (media save)."""
    create = await client_as_alice.post(
        f"{api_base}/transactions/{TX_PRE_LISTING}/documents",
        json={"document_type": "addendum"},
    )
    assert create.status_code == 201
    document_id = create.json()["document_id"]
    url_r = await client_as_alice.post(
        f"{api_base}/documents/{document_id}/upload-url",
        json={"filename": "addendum.pdf", "content_type": "application/pdf"},
    )
    assert url_r.status_code == 200
    storage_path = url_r.json()["storage_path"]
    storage_bucket = url_r.json()["storage_bucket"]
    ver = await client_as_alice.post(
        f"{api_base}/documents/{document_id}/versions",
        json={
            "storage_path": storage_path,
            "storage_bucket": storage_bucket,
            "checksum": "sha256:abc123",
        },
    )
    assert ver.status_code == 201
    v = ver.json()
    assert v["document_id"] == document_id
    assert v["storage_path"] == storage_path
    assert v["storage_bucket"] == storage_bucket
    assert v["checksum"] == "sha256:abc123"


@pytest.mark.asyncio
async def test_list_document_versions(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /documents/{id}/versions returns 200 and list of versions (Phase B.4)."""
    create = await client_as_alice.post(
        f"{api_base}/transactions/{TX_PRE_LISTING}/documents",
        json={"document_type": "addendum"},
    )
    assert create.status_code == 201
    document_id = create.json()["document_id"]
    url_r = await client_as_alice.post(
        f"{api_base}/documents/{document_id}/upload-url",
        json={"filename": "v1.pdf", "content_type": "application/pdf"},
    )
    assert url_r.status_code == 200
    storage_path = url_r.json()["storage_path"]
    storage_bucket = url_r.json()["storage_bucket"]
    await client_as_alice.post(
        f"{api_base}/documents/{document_id}/versions",
        json={"storage_path": storage_path, "storage_bucket": storage_bucket, "checksum": "sha256:def456"},
    )
    response = await client_as_alice.get(f"{api_base}/documents/{document_id}/versions")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 1
    v = data[0]
    assert v["document_id"] == document_id
    assert "version_id" in v
    assert "created_at" in v
    assert v["checksum"] == "sha256:def456"


@pytest.mark.asyncio
async def test_list_document_versions_not_found(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /documents/{id}/versions returns 404 for unknown document."""
    response = await client_as_alice.get(f"{api_base}/documents/{NONEXISTENT_UUID}/versions")
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"
