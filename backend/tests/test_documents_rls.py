"""RLS negative tests: lender must not see inspection_report; non-party must not create documents (06-authorization-and-data-access)."""
import pytest
from httpx import AsyncClient

from tests.conftest import error_code

# Seed document (03-seed.sql): inspection_report on tx 001; Eve is LENDER party on tx 001
DOC_INSPECTION_REPORT = "a1000001-0000-0000-0000-000000000001"

# Transaction 003 (03-seed): LISTED with public listing; parties are SELLER_AGENT (user 001) and SELLER (user 003).
# Bob (user 002, BUYER) can see this transaction via LISTED+public listing but is not a party → document INSERT denied → 403.
TX_LISTED_PUBLIC_NOT_BOB = "c0000001-0000-0000-0000-000000000003"

# Transaction 005: DUE_DILIGENCE; Bob (BUYER) is a party. appraisal_report insert denied for BUYER (RLS).
TX_005_DUE_DILIGENCE = "c0000001-0000-0000-0000-000000000005"

# Transaction 006: FINANCING; Eve (LENDER) is a party. appraisal_report insert allowed for LENDER.
TX_006_FINANCING = "c0000001-0000-0000-0000-000000000006"


def _error_message(response_json: dict) -> str:
    """Extract error message from FastAPI error response (detail.error.message)."""
    return ((response_json.get("detail") or {}).get("error") or {}).get("message") or ""


@pytest.mark.asyncio
async def test_lender_cannot_see_inspection_report(client_as_eve: AsyncClient, api_base: str) -> None:
    """RLS: LENDER must not see inspection_report documents (06 explicit deny)."""
    r = await client_as_eve.get(f"{api_base}/documents/{DOC_INSPECTION_REPORT}")
    assert r.status_code == 404, "Lender must get 404 for inspection_report document"
    assert error_code(r.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_non_party_cannot_create_document_returns_403_forbidden_by_policy(
    client_as_bob: AsyncClient, api_base: str
) -> None:
    """RLS: User who can see a transaction (e.g. LISTED + public listing) but is not a party gets 403 FORBIDDEN_BY_POLICY when creating a document (06)."""
    r = await client_as_bob.post(
        f"{api_base}/transactions/{TX_LISTED_PUBLIC_NOT_BOB}/documents",
        json={"document_type": "purchase_agreement"},
    )
    assert r.status_code == 403, "Non-party must get 403 when creating document on visible transaction"
    data = r.json()
    assert error_code(data) == "FORBIDDEN_BY_POLICY"
    msg = _error_message(data)
    assert "same user" in msg.lower() or "organization" in msg.lower(), (
        "Error message should mention using same user/org that created the transaction"
    )


@pytest.mark.asyncio
async def test_buyer_cannot_create_appraisal_report_document_returns_403(
    client_as_bob: AsyncClient, api_base: str
) -> None:
    """RLS: BUYER who is a transaction party cannot insert appraisal_report (only LENDER/ESCROW_OFFICER/APPRAISER)."""
    r = await client_as_bob.post(
        f"{api_base}/transactions/{TX_005_DUE_DILIGENCE}/documents",
        json={"document_type": "appraisal_report"},
    )
    assert r.status_code == 403
    assert error_code(r.json()) == "FORBIDDEN_BY_POLICY"


@pytest.mark.asyncio
async def test_lender_can_create_appraisal_report_document(client_as_eve: AsyncClient, api_base: str) -> None:
    """RLS: LENDER who is a transaction party can insert appraisal_report in FINANCING."""
    r = await client_as_eve.post(
        f"{api_base}/transactions/{TX_006_FINANCING}/documents",
        json={"document_type": "appraisal_report"},
    )
    assert r.status_code == 201
    assert r.json()["document_type"] == "appraisal_report"
