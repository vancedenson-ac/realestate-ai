"""V1 API router: mount under /realtrust-ai/v1."""
from fastapi import APIRouter

from realtrust_api.api.v1.endpoints import (
    transactions,
    properties,
    listings,
    documents,
    inspections,
    appraisals,
    events,
    users_me,
    ai_insights,
    chat,
    offers,
    showings,
    escrow,
    title,
)

api_router = APIRouter()

api_router.include_router(transactions.router, prefix="/transactions", tags=["transactions"])
api_router.include_router(properties.router, prefix="/properties", tags=["properties"])
api_router.include_router(listings.router, prefix="/listings", tags=["listings"])
api_router.include_router(documents.router, tags=["documents"])
api_router.include_router(inspections.router, tags=["inspections"])
api_router.include_router(appraisals.router, tags=["appraisals"])
api_router.include_router(events.router, tags=["events"])
api_router.include_router(users_me.router, prefix="/users/me", tags=["users"])
api_router.include_router(ai_insights.router, prefix="/ai/insights", tags=["ai"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(offers.router, tags=["offers"])
api_router.include_router(showings.router, tags=["showings"])
api_router.include_router(escrow.router, tags=["escrow"])
api_router.include_router(title.router, tags=["title"])
