#!/usr/bin/env python3
"""Test property image upload against a running API + MinIO.
Usage (from repo root or backend):
  python backend/scripts/test_upload_image.py [path/to/image.png]
  python scripts/test_upload_image.py realtrustai-customer-journey.png

Requires: API running (e.g. docker compose up api), MinIO with CORS set.
Uses seed property d0000001-0000-0000-0000-000000000001 and Alice (SELLER_AGENT) headers.
"""
import argparse
import sys
from pathlib import Path

try:
    import httpx
except ImportError:
    print("Run: pip install httpx", file=sys.stderr)
    sys.exit(1)

API_BASE = "http://localhost:8000/realtrust-ai/v1"
PROP_OAK = "d0000001-0000-0000-0000-000000000001"
HEADERS = {
    "X-User-Id": "b0000001-0000-0000-0000-000000000001",
    "X-Role": "SELLER_AGENT",
    "X-Organization-Id": "a0000001-0000-0000-0000-000000000001",
    "Content-Type": "application/json",
    "Accept": "application/json",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Test property image upload to MinIO")
    parser.add_argument("file", nargs="?", default="realtrustai-customer-journey.png", help="Image file path")
    parser.add_argument("--api-base", default=API_BASE, help="API base URL")
    parser.add_argument("--property-id", default=PROP_OAK, help="Property UUID")
    args = parser.parse_args()

    path = Path(args.file)
    if not path.exists():
        # Try from repo root
        root = Path(__file__).resolve().parent.parent.parent
        path = root / args.file
    if not path.exists():
        print(f"File not found: {args.file}", file=sys.stderr)
        return 1

    content_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    url_path = f"{args.api_base.rstrip('/')}/properties/{args.property_id}/images/upload"

    with httpx.Client(timeout=30.0) as client:
        # 1) Get presigned URL
        r = client.post(
            url_path,
            headers=HEADERS,
            json={"filename": path.name, "content_type": content_type},
        )
        if r.status_code != 200:
            print(f"Upload URL failed: {r.status_code} {r.text}", file=sys.stderr)
            return 1
        data = r.json()
        upload_url = data.get("upload_url")
        if not upload_url:
            print("No upload_url in response", file=sys.stderr)
            return 1
        print(f"Presigned URL: {upload_url[:80]}...")

        # 2) PUT file to presigned URL (no auth headers; URL is signed)
        body = path.read_bytes()
        put_headers = {"Content-Type": content_type}
        put_r = client.put(upload_url, content=body, headers=put_headers)
        if put_r.status_code not in (200, 204):
            print(f"PUT failed: {put_r.status_code} {put_r.text}", file=sys.stderr)
            return 1

    print("Upload succeeded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
