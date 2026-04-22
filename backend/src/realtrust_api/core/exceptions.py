"""Canonical API error codes and exception handling (09-views-and-apis)."""
from fastapi import HTTPException, status

# Canonical error codes from spec
ERROR_CODES = (
    "UNAUTHENTICATED",
    "UNAUTHORIZED",
    "FORBIDDEN_BY_POLICY",
    "ILLEGAL_TRANSITION",
    "PRECONDITION_FAILED",
    "CONFLICT",
    "NOT_FOUND",
    "VALIDATION_ERROR",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
)


def error_response(code: str, message: str, details: dict | None = None) -> dict:
    """Build standard error body."""
    body: dict = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    return body


def not_found_exception(resource: str, resource_id: str) -> HTTPException:
    """404 with NOT_FOUND code (RLS invisibility may surface as not found)."""
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=error_response("NOT_FOUND", f"{resource} not found", {"id": resource_id}),
    )


def forbidden_by_policy_exception(message: str, details: dict | None = None) -> HTTPException:
    """403 with FORBIDDEN_BY_POLICY (e.g. RLS denies insert/update)."""
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=error_response("FORBIDDEN_BY_POLICY", message, details),
    )


def illegal_transition_exception(message: str, details: dict | None = None) -> HTTPException:
    """400/409 for illegal state transition."""
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=error_response("ILLEGAL_TRANSITION", message, details),
    )


def precondition_failed_exception(message: str, details: dict | None = None) -> HTTPException:
    """412 Precondition Failed."""
    return HTTPException(
        status_code=status.HTTP_412_PRECONDITION_FAILED,
        detail=error_response("PRECONDITION_FAILED", message, details),
    )


def conflict_exception(message: str, details: dict | None = None) -> HTTPException:
    """409 Conflict (idempotency / optimistic concurrency)."""
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=error_response("CONFLICT", message, details),
    )


def validation_exception(message: str, details: dict | None = None) -> HTTPException:
    """422 Validation Error."""
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=error_response("VALIDATION_ERROR", message, details),
    )
