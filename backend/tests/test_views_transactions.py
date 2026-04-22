"""Transaction view endpoints: checklist + timeline."""

import pytest
from httpx import AsyncClient

TX_PRE_LISTING = "c0000001-0000-0000-0000-000000000002"


@pytest.mark.asyncio
async def test_document_checklist_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_PRE_LISTING}/document-checklist")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    for item in data:
        assert "kind" in item, "Checklist item must have kind"
        assert item["kind"] in ("document", "milestone"), f"Invalid kind: {item.get('kind')}"
        assert "required_for_to_state" in item
        assert "present" in item
        if item["kind"] == "document":
            assert "document_type" in item
            assert "signed" in item
        else:
            assert item["kind"] == "milestone"
            assert "milestone_key" in item
            assert "label" in item


@pytest.mark.asyncio
async def test_transaction_timeline_ok(client_as_alice: AsyncClient, api_base: str) -> None:
    r = await client_as_alice.get(f"{api_base}/transactions/{TX_PRE_LISTING}/timeline")
    assert r.status_code == 200
    data = r.json()
    assert "state_changes" in data
    assert "events" in data

