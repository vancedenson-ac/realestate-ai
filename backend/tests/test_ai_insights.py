"""AI insight endpoints (stubs): GET /transactions/{id}/ai/insights, POST /ai/insights/{id}/approve."""
import pytest
from httpx import AsyncClient

from tests.conftest import error_code

# Seed (03-seed.sql)
TXN_1 = "c0000001-0000-0000-0000-000000000001"
TXN_2 = "c0000001-0000-0000-0000-000000000002"
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"
INSIGHT_STUB_ID = "a0000001-0000-0000-0000-000000000001"


@pytest.mark.asyncio
async def test_list_transaction_ai_insights_ok(client: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/ai/insights returns 200 and list (stub returns empty)."""
    response = await client.get(f"{api_base}/transactions/{TXN_1}/ai/insights")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert data == []


@pytest.mark.asyncio
async def test_list_transaction_ai_insights_not_found(client: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/ai/insights returns 404 for unknown transaction."""
    response = await client.get(f"{api_base}/transactions/{NONEXISTENT_UUID}/ai/insights")
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_approve_ai_insight_stub(client: AsyncClient, api_base: str) -> None:
    """POST /ai/insights/{id}/approve returns 200 and stub status."""
    response = await client.post(f"{api_base}/ai/insights/{INSIGHT_STUB_ID}/approve")
    assert response.status_code == 200
    data = response.json()
    assert data["insight_id"] == INSIGHT_STUB_ID
    assert data["status"] == "approved"
