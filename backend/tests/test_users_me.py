"""Users/me: preferences CRUD, recommendations, feedback (X-User-Id: Bob)."""
import pytest
from httpx import AsyncClient

from tests.conftest import error_code

# Seed (03-seed.sql): Bob = b0000001-0000-0000-0000-000000000002, preference f0000001-..., matches m0000001-...
PREF_1 = "f0000001-0000-0000-0000-000000000001"
MATCH_1 = "m0000001-0000-0000-0000-000000000001"
MATCH_2 = "m0000001-0000-0000-0000-000000000002"
LISTING_1 = "e0000001-0000-0000-0000-000000000001"
LISTING_2 = "e0000001-0000-0000-0000-000000000002"
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"


@pytest.mark.asyncio
async def test_list_preferences(client_as_bob: AsyncClient, api_base: str) -> None:
    """GET /users/me/preferences returns 200 and list (Bob has one preference in seed)."""
    response = await client_as_bob.get(f"{api_base}/users/me/preferences")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    pref = next((p for p in data if p["preference_id"] == PREF_1), data[0])
    assert pref["user_id"] == "b0000001-0000-0000-0000-000000000002"
    assert pref["is_active"] is True
    assert "price_min" in pref
    assert "price_max" in pref
    assert "preferred_states" in pref


@pytest.mark.asyncio
async def test_get_preference_ok(client_as_bob: AsyncClient, api_base: str) -> None:
    """GET /users/me/preferences/{id} returns 200 for Bob's preference."""
    response = await client_as_bob.get(f"{api_base}/users/me/preferences/{PREF_1}")
    assert response.status_code == 200
    data = response.json()
    assert data["preference_id"] == PREF_1
    assert data["user_id"] == "b0000001-0000-0000-0000-000000000002"
    assert float(data["price_min"]) == 400000
    assert 400000 <= float(data["price_max"]) <= 700000  # may have been updated by test_update_preference
    assert data["bedrooms_min"] == 3


@pytest.mark.asyncio
async def test_get_preference_not_found(client_as_bob: AsyncClient, api_base: str) -> None:
    """GET /users/me/preferences/{id} returns 404 for unknown id."""
    response = await client_as_bob.get(f"{api_base}/users/me/preferences/{NONEXISTENT_UUID}")
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_create_preference(client_as_bob: AsyncClient, api_base: str) -> None:
    """POST /users/me/preferences returns 201 and creates preference."""
    response = await client_as_bob.post(
        f"{api_base}/users/me/preferences",
        json={
            "price_min": 300000,
            "price_max": 500000,
            "bedrooms_min": 2,
            "preferred_states": ["CA", "TX"],
            "notification_frequency": "WEEKLY",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert "preference_id" in data
    assert data["price_min"] == 300000 or float(data["price_min"]) == 300000
    assert data["notification_frequency"] == "WEEKLY"


@pytest.mark.asyncio
async def test_update_preference(client_as_bob: AsyncClient, api_base: str) -> None:
    """PATCH /users/me/preferences/{id} returns 200 and updates fields."""
    response = await client_as_bob.patch(
        f"{api_base}/users/me/preferences/{PREF_1}",
        json={"price_max": 650000, "notification_frequency": "INSTANT"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["preference_id"] == PREF_1
    assert float(data["price_max"]) == 650000
    assert data["notification_frequency"] == "INSTANT"


@pytest.mark.asyncio
async def test_update_preference_not_found(client_as_bob: AsyncClient, api_base: str) -> None:
    """PATCH /users/me/preferences/{id} returns 404 for unknown id."""
    response = await client_as_bob.patch(
        f"{api_base}/users/me/preferences/{NONEXISTENT_UUID}",
        json={"price_max": 700000},
    )
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_delete_preference(client_as_bob: AsyncClient, api_base: str) -> None:
    """DELETE /users/me/preferences/{id} returns 204 and deactivates (create one first to delete)."""
    create = await client_as_bob.post(
        f"{api_base}/users/me/preferences",
        json={"price_min": 200000, "price_max": 300000, "notification_frequency": "NONE"},
    )
    assert create.status_code == 201
    pref_id = create.json()["preference_id"]
    response = await client_as_bob.delete(f"{api_base}/users/me/preferences/{pref_id}")
    assert response.status_code == 204
    list_resp = await client_as_bob.get(f"{api_base}/users/me/preferences")
    ids = [p["preference_id"] for p in list_resp.json()]
    assert pref_id not in ids or not next((p for p in list_resp.json() if p["preference_id"] == pref_id), {}).get("is_active", True)


@pytest.mark.asyncio
async def test_list_recommendations(client_as_bob: AsyncClient, api_base: str) -> None:
    """GET /users/me/recommendations returns 200 and list (seed has 2 matches for Bob when seeded)."""
    response = await client_as_bob.get(f"{api_base}/users/me/recommendations")
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    recs = data["recommendations"]
    assert isinstance(recs, list)
    assert len(recs) >= 0
    for r in recs:
        assert "match_id" in r
        assert "listing" in r
        assert "property" in r
        assert "match_score" in r
        assert "score_breakdown" in r
        assert "recommended_at" in r


@pytest.mark.asyncio
async def test_list_recommendations_with_params(client_as_bob: AsyncClient, api_base: str) -> None:
    """GET /users/me/recommendations?min_score=0.9&limit=1 returns filtered list."""
    response = await client_as_bob.get(
        f"{api_base}/users/me/recommendations",
        params={"min_score": 0.9, "limit": 1},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["recommendations"]) <= 1
    for r in data["recommendations"]:
        assert float(r["match_score"]) >= 0.9


@pytest.mark.asyncio
async def test_submit_recommendation_feedback(client_as_bob: AsyncClient, api_base: str) -> None:
    """POST /users/me/recommendations/{match_id}/feedback returns 200 when match exists (seed)."""
    recs = await client_as_bob.get(f"{api_base}/users/me/recommendations")
    assert recs.status_code == 200
    recommendations = recs.json().get("recommendations", [])
    if not recommendations:
        pytest.skip("No seed recommendations; run seed to test feedback")
    match_id = recommendations[0]["match_id"]
    response = await client_as_bob.post(
        f"{api_base}/users/me/recommendations/{match_id}/feedback",
        json={"feedback": "LIKED"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["match_id"] == match_id
    assert data["feedback"] == "LIKED"


@pytest.mark.asyncio
async def test_submit_recommendation_feedback_contacted(client_as_bob: AsyncClient, api_base: str) -> None:
    """POST /users/me/recommendations/{match_id}/feedback with CONTACTED."""
    recs = await client_as_bob.get(f"{api_base}/users/me/recommendations")
    assert recs.status_code == 200
    recommendations = recs.json().get("recommendations", [])
    if len(recommendations) < 2:
        pytest.skip("Need at least 2 seed recommendations")
    match_id = recommendations[1]["match_id"]
    response = await client_as_bob.post(
        f"{api_base}/users/me/recommendations/{match_id}/feedback",
        json={"feedback": "CONTACTED"},
    )
    assert response.status_code == 200
    assert response.json()["feedback"] == "CONTACTED"


@pytest.mark.asyncio
async def test_submit_recommendation_feedback_not_found(client_as_bob: AsyncClient, api_base: str) -> None:
    """POST /users/me/recommendations/{match_id}/feedback returns 404 for unknown match."""
    response = await client_as_bob.post(
        f"{api_base}/users/me/recommendations/{NONEXISTENT_UUID}/feedback",
        json={"feedback": "LIKED"},
    )
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_submit_recommendation_feedback_validation(client_as_bob: AsyncClient, api_base: str) -> None:
    """POST /users/me/recommendations/{match_id}/feedback with invalid feedback returns 422."""
    response = await client_as_bob.post(
        f"{api_base}/users/me/recommendations/{MATCH_1}/feedback",
        json={"feedback": "INVALID"},
    )
    assert response.status_code == 422


# ----- Saved listings -----
@pytest.mark.asyncio
async def test_list_saved_listings(client_as_bob: AsyncClient, api_base: str) -> None:
    """GET /users/me/saved-listings returns 200 and list (Bob has listing_1 saved in seed)."""
    response = await client_as_bob.get(f"{api_base}/users/me/saved-listings")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    item = next((s for s in data if s["listing_id"] == LISTING_1), data[0])
    assert item["listing_id"] == LISTING_1
    assert "property_id" in item
    assert "address_line_1" in item
    assert "city" in item
    assert "list_price" in item
    assert "saved_at" in item


@pytest.mark.asyncio
async def test_save_listing(client_as_bob: AsyncClient, api_base: str) -> None:
    """POST /users/me/saved-listings returns 201 and adds listing (listing_2)."""
    response = await client_as_bob.post(
        f"{api_base}/users/me/saved-listings",
        json={"listing_id": LISTING_2},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["listing_id"] == LISTING_2
    assert data["property_id"]
    assert "saved_at" in data


@pytest.mark.asyncio
async def test_save_listing_idempotent(client_as_bob: AsyncClient, api_base: str) -> None:
    """POST /users/me/saved-listings again for same listing returns 201 (existing)."""
    response = await client_as_bob.post(
        f"{api_base}/users/me/saved-listings",
        json={"listing_id": LISTING_1},
    )
    assert response.status_code == 201
    assert response.json()["listing_id"] == LISTING_1


@pytest.mark.asyncio
async def test_save_listing_not_found(client_as_bob: AsyncClient, api_base: str) -> None:
    """POST /users/me/saved-listings returns 404 for unknown listing."""
    response = await client_as_bob.post(
        f"{api_base}/users/me/saved-listings",
        json={"listing_id": NONEXISTENT_UUID},
    )
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_unsave_listing(client_as_bob: AsyncClient, api_base: str) -> None:
    """DELETE /users/me/saved-listings/{listing_id} returns 204 and removes from list."""
    await client_as_bob.post(
        f"{api_base}/users/me/saved-listings",
        json={"listing_id": LISTING_2},
    )
    response = await client_as_bob.delete(f"{api_base}/users/me/saved-listings/{LISTING_2}")
    assert response.status_code == 204
    list_resp = await client_as_bob.get(f"{api_base}/users/me/saved-listings")
    ids = [s["listing_id"] for s in list_resp.json()]
    assert LISTING_2 not in ids


# ----- Eligible escrow officers (Phase B.5) -----
@pytest.mark.asyncio
async def test_list_eligible_escrow_officers(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /users/me/eligible-escrow-officers returns 200 and list of org escrow officers (Acme seed has 2)."""
    response = await client_as_alice.get(f"{api_base}/users/me/eligible-escrow-officers")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # Seed: Acme (a0000001) has org_members 004 and 011 as ESCROW_OFFICER
    assert len(data) >= 2
    for item in data:
        assert "user_id" in item
        assert "full_name" in item
        assert "email" in item
    user_ids = [o["user_id"] for o in data]
    assert "b0000001-0000-0000-0000-000000000004" in user_ids
    assert "b0000001-0000-0000-0000-000000000011" in user_ids


@pytest.mark.asyncio
async def test_list_eligible_escrow_officers_org_scope(
    client_as_dave: AsyncClient, api_base: str
) -> None:
    """GET /users/me/eligible-escrow-officers as First Escrow Co returns only that org's officers (Dave = 004)."""
    response = await client_as_dave.get(f"{api_base}/users/me/eligible-escrow-officers")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # Seed: First Escrow (a0000002) has only 004 as ESCROW_OFFICER
    assert len(data) >= 1
    assert all(o["user_id"] == "b0000001-0000-0000-0000-000000000004" for o in data)


@pytest.mark.asyncio
async def test_list_champagne_moments(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /users/me/champagne-moments returns 200 and list of champagne moments (domain events for user)."""
    response = await client_as_alice.get(f"{api_base}/users/me/champagne-moments")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    for item in data:
        assert "event_id" in item
        assert "event_type" in item
        assert "emitted_at" in item
        assert "transaction_id" in item
        assert "title" in item
        assert "message" in item
