"""Application configuration from environment."""
from pydantic_settings import BaseSettings, SettingsConfigDict


def _parse_cors_origins(v: str) -> list[str]:
    """Parse comma-separated CORS origins; strip whitespace; drop empty."""
    return [o.strip() for o in v.split(",") if o.strip()]


class Settings(BaseSettings):
    """Realtrust API settings. Load from env / .env."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database (dev/test): connect as non-superuser so RLS is enforced (06).
    # Schema/seed are applied using the superuser (realtrust) via scripts.
    DATABASE_URL: str = "postgresql+asyncpg://app_user:realtrust@localhost:5432/realtrust"

    # API
    API_V1_PREFIX: str = "/realtrust-ai/v1"
    DEBUG: bool = False

    # CORS — comma-separated origins (e.g. http://localhost:3000,http://127.0.0.1:3000)
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # S3-compatible storage (MinIO). If not set, presigned URLs are stubs (tests/dev without MinIO).
    S3_ENDPOINT_URL: str | None = None  # e.g. http://minio:9000 (from API) or http://localhost:9000
    S3_PUBLIC_ENDPOINT_URL: str | None = None  # URL the browser uses for presigned PUT (e.g. http://localhost:9000 when API runs in Docker)
    S3_BUCKET: str = "realtrust"
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_REGION: str = "us-east-1"
    S3_USE_SSL: bool = True  # False for local MinIO (http)

    @property
    def cors_origins_list(self) -> list[str]:
        return _parse_cors_origins(self.CORS_ORIGINS)

    @property
    def storage_configured(self) -> bool:
        """True if S3/MinIO credentials and endpoint are set for real presigned URLs."""
        return bool(
            self.S3_ENDPOINT_URL and self.S3_ACCESS_KEY and self.S3_SECRET_KEY
        )


settings = Settings()
