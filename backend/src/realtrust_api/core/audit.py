"""Audit evidence writer (SOC2/FINRA oriented).

This module writes append-only `audit_events` rows as regulated evidence.
The DB remains the system of record; audit rows are evidence of actions/outcomes.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, timedelta
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _stable_json(obj: object) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


async def write_audit_event(
    db: AsyncSession,
    *,
    event_type: str,
    event_category: str,
    actor_id: UUID,
    actor_role: str,
    resource_type: str,
    resource_id: UUID | None,
    transaction_id: UUID | None,
    action: str,
    outcome: str,
    details: dict | None = None,
    correlation_id: str | None = None,
    request_id: str | None = None,
    actor_ip_address: str | None = None,
    actor_user_agent: str | None = None,
    actor_type: str = "user",
    retention_category: str = "standard_6yr",
    retention_until: date | None = None,
) -> UUID:
    """Insert an audit_events row (append-only evidence).

    Note: In production, UPDATE/DELETE on audit tables must be revoked and/or blocked.
    """
    eid = uuid4()
    retention_until = retention_until or (date.today() + timedelta(days=365 * 6))
    details_obj = details or {}

    hash_input = _stable_json(
        {
            "event_id": str(eid),
            "event_type": event_type,
            "event_category": event_category,
            "actor_id": str(actor_id),
            "actor_type": actor_type,
            "actor_role": actor_role,
            "resource_type": resource_type,
            "resource_id": str(resource_id) if resource_id is not None else None,
            "transaction_id": str(transaction_id) if transaction_id is not None else None,
            "action": action,
            "outcome": outcome,
            "details": details_obj,
            "correlation_id": correlation_id,
            "request_id": request_id,
        }
    )
    event_hash = _sha256_hex(hash_input)

    await db.execute(
        text(
            "INSERT INTO audit_events ("
            "event_id, event_type, event_category, "
            "actor_id, actor_type, actor_role, actor_ip_address, actor_user_agent, "
            "resource_type, resource_id, transaction_id, action, outcome, details, "
            "previous_event_hash, event_hash, retention_category, retention_until, legal_hold, correlation_id, request_id"
            ") VALUES ("
            "CAST(:event_id AS uuid), :event_type, :event_category, "
            "CAST(:actor_id AS uuid), :actor_type, :actor_role, CAST(:actor_ip_address AS inet), :actor_user_agent, "
            ":resource_type, CAST(:resource_id AS uuid), CAST(:transaction_id AS uuid), :action, :outcome, CAST(:details AS jsonb), "
            ":previous_event_hash, :event_hash, :retention_category, :retention_until, false, :correlation_id, :request_id"
            ")"
        ),
        {
            "event_id": str(eid),
            "event_type": event_type,
            "event_category": event_category,
            "actor_id": str(actor_id),
            "actor_type": actor_type,
            "actor_role": actor_role,
            "actor_ip_address": actor_ip_address,
            "actor_user_agent": actor_user_agent,
            "resource_type": resource_type,
            "resource_id": str(resource_id) if resource_id is not None else None,
            "transaction_id": str(transaction_id) if transaction_id is not None else None,
            "action": action,
            "outcome": outcome,
            "details": _stable_json(details_obj),
            "previous_event_hash": None,
            "event_hash": event_hash,
            "retention_category": retention_category,
            "retention_until": retention_until,
            "correlation_id": correlation_id,
            "request_id": request_id,
        },
    )
    return eid


async def log_access_decision(
    db: AsyncSession,
    *,
    actor_id: UUID,
    actor_role: str,
    resource_type: str,
    resource_id: UUID | None,
    transaction_id: UUID | None,
    outcome: str,
    policy_reference: str,
    correlation_id: str | None = None,
    request_id: str | None = None,
    actor_ip_address: str | None = None,
    actor_user_agent: str | None = None,
) -> UUID:
    """Log a sensitive read access decision (allow/deny) per 02 §5, AUDIT §8.3.
    Records identity, resource, outcome, and policy reference for provability.
    """
    return await write_audit_event(
        db,
        event_type="AccessDecision",
        event_category="access",
        actor_id=actor_id,
        actor_role=actor_role,
        resource_type=resource_type,
        resource_id=resource_id,
        transaction_id=transaction_id,
        action="read",
        outcome=outcome,
        details={"policy_reference": policy_reference},
        correlation_id=correlation_id,
        request_id=request_id,
        actor_ip_address=actor_ip_address,
        actor_user_agent=actor_user_agent,
    )

