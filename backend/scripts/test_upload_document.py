#!/usr/bin/env python3
"""Test document upload against a running API + MinIO.
Usage (from repo root):
  python backend/scripts/test_upload_document.py [path/to/file.pdf]
  python backend/scripts/test_upload_document.py Emerging_Tech_Bitcoin_Crypto.pdf

Requires: API running (e.g. docker compose up api), MinIO with CORS set.
Uses seed transaction and Alice (SELLER_AGENT) headers.
"""
import argparse
import hashlib
import sys
from pathlib import Path

try:
    import httpx
except ImportError:
    print("Run: pip install httpx", file=sys.stderr)
    sys.exit(1)

API_BASE = "http://localhost:8000/realtrust-ai/v1"
# Seed transaction (e.g. PRE_LISTING) from 03-seed.sql
TX_ID = "c0000001-0000-0000-0000-000000000002"
HEADERS = {
    "X-User-Id": "b0000001-0000-0000-0000-000000000001",
    "X-Role": "SELLER_AGENT",
    "X-Organization-Id": "a0000001-0000-0000-0000-000000000001",
    "Content-Type": "application/json",
    "Accept": "application/json",
}


def sha256_hex(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Test document upload to MinIO")
    parser.add_argument("file", nargs="?", default="Emerging_Tech_Bitcoin_Crypto.pdf", help="Document file path (e.g. .pdf)")
    parser.add_argument("--api-base", default=API_BASE, help="API base URL")
    parser.add_argument("--transaction-id", default=TX_ID, help="Transaction UUID")
    parser.add_argument("--document-type", default="purchase_agreement", help="Document type")
    args = parser.parse_args()

    path = Path(args.file)
    if not path.exists():
        root = Path(__file__).resolve().parent.parent.parent
        path = root / args.file
    if not path.exists():
        print(f"File not found: {args.file}", file=sys.stderr)
        return 1

    content_type = "application/pdf" if path.suffix.lower() == ".pdf" else "application/octet-stream"

    with httpx.Client(timeout=60.0) as client:
        # 1) Create document
        r = client.post(
            f"{args.api_base.rstrip('/')}/transactions/{args.transaction_id}/documents",
            headers=HEADERS,
            json={"document_type": args.document_type},
        )
        if r.status_code not in (200, 201):
            print(f"Create document failed: {r.status_code} {r.text}", file=sys.stderr)
            return 1
        data = r.json()
        doc_id = data.get("document_id")
        if not doc_id:
            print("No document_id in response", file=sys.stderr)
            return 1
        print(f"Created document: {doc_id}")

        # 2) Get presigned upload URL
        r2 = client.post(
            f"{args.api_base.rstrip('/')}/documents/{doc_id}/upload-url",
            headers=HEADERS,
            json={"filename": path.name, "content_type": content_type},
        )
        if r2.status_code != 200:
            print(f"Upload URL failed: {r2.status_code} {r2.text}", file=sys.stderr)
            return 1
        data2 = r2.json()
        upload_url = data2.get("upload_url")
        storage_path = data2.get("storage_path")
        storage_bucket = data2.get("storage_bucket")
        if not upload_url or not storage_path or not storage_bucket:
            print("Missing upload_url, storage_path, or storage_bucket", file=sys.stderr)
            return 1
        print(f"Presigned URL: {upload_url[:80]}...")

        # 3) PUT file to presigned URL
        body = path.read_bytes()
        put_r = client.put(upload_url, content=body, headers={"Content-Type": content_type})
        if put_r.status_code not in (200, 204):
            print(f"PUT failed: {put_r.status_code} {put_r.text}", file=sys.stderr)
            return 1
        print("PUT to MinIO succeeded.")

        # 4) Add version (storage_path, storage_bucket, checksum)
        checksum = sha256_hex(path)
        r3 = client.post(
            f"{args.api_base.rstrip('/')}/documents/{doc_id}/versions",
            headers=HEADERS,
            json={"storage_path": storage_path, "storage_bucket": storage_bucket, "checksum": checksum},
        )
        if r3.status_code not in (200, 201):
            print(f"Add version failed: {r3.status_code} {r3.text}", file=sys.stderr)
            return 1
        print("Add version succeeded.")

    print("Document upload end-to-end succeeded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
