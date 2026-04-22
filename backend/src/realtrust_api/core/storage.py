"""S3-compatible storage (MinIO): presigned PUT URLs for document and image uploads.
When config has no S3 credentials, returns stub URLs so DB records and tests work without MinIO.
Uses the MinIO Python SDK for presigned URLs so the signature matches MinIO (avoids boto3 Host/port issues).
"""
from __future__ import annotations

from urllib.parse import urlparse

from realtrust_api.config import settings


def _minio_endpoint_for_presign() -> tuple[str, int, bool]:
    """Return (host, port, secure) for the client-visible endpoint (e.g. localhost:9000 in Docker)."""
    endpoint_url = (
        getattr(settings, "S3_PUBLIC_ENDPOINT_URL", None) or ""
    ).strip() or (settings.S3_ENDPOINT_URL or "")
    parsed = urlparse(endpoint_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    secure = parsed.scheme == "https"
    return host, port, secure


def get_presigned_put_url(
    key: str,
    content_type: str = "application/octet-stream",
    expires_in: int = 3600,
) -> tuple[str, str, str]:
    """Return (upload_url, storage_bucket, storage_path) for client to PUT file.
    storage_path equals key for DB; bucket from config.
    When storage is not configured, returns stub URL; path/bucket still valid for DB.
    Uses MinIO SDK so presigned URL signature is valid for browser/host requests.
    """
    bucket = settings.S3_BUCKET
    path = key

    if not settings.storage_configured:
        stub_url = f"https://stub.example.com/upload?bucket={bucket}&key={key}&expires={expires_in}"
        return stub_url, bucket, path

    from datetime import timedelta

    from minio import Minio

    host, port, secure = _minio_endpoint_for_presign()
    endpoint = f"{host}:{port}"
    client = Minio(
        endpoint,
        access_key=settings.S3_ACCESS_KEY,
        secret_key=settings.S3_SECRET_KEY,
        secure=secure,
        region=settings.S3_REGION,
    )
    url = client.presigned_put_object(
        bucket_name=bucket,
        object_name=key,
        expires=timedelta(seconds=expires_in),
    )
    return url, bucket, path


def get_presigned_get_url(bucket: str, key: str, expires_in: int = 300) -> str | None:
    """Return a presigned GET URL for the client to view/download an object, or None if storage not configured."""
    if not settings.storage_configured:
        return None
    from datetime import timedelta

    from minio import Minio

    host, port, secure = _minio_endpoint_for_presign()
    endpoint = f"{host}:{port}"
    client = Minio(
        endpoint,
        access_key=settings.S3_ACCESS_KEY,
        secret_key=settings.S3_SECRET_KEY,
        secure=secure,
        region=settings.S3_REGION,
    )
    return client.presigned_get_object(
        bucket_name=bucket,
        object_name=key,
        expires=timedelta(seconds=expires_in),
    )


def ensure_bucket_exists() -> None:
    """Create the configured S3 bucket if it does not exist. Safe to call at startup when storage_configured."""
    if not settings.storage_configured:
        return
    import boto3
    from botocore.exceptions import ClientError

    client = boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        use_ssl=settings.S3_USE_SSL,
    )
    bucket = settings.S3_BUCKET
    try:
        client.create_bucket(Bucket=bucket)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
            raise
