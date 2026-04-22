"""AI insight endpoints (10-ai-boundaries: SYSTEM_AI write to non-authoritative only; human approval)."""
from uuid import UUID
from fastapi import APIRouter, Depends
from realtrust_api.api.deps import get_current_user_id, get_db_with_rls
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


@router.post("/{insight_id}/approve")
async def approve_ai_insight(
    insight_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
    current_user_id: UUID = Depends(get_current_user_id),
) -> dict:
    """Approve AI insight when policy requires human approval (stub; when ai_insights table exists,
    use get_db_with_rls and enforce RLS; only transaction-party or compliance role may approve).
    """
    return {"insight_id": str(insight_id), "status": "approved"}