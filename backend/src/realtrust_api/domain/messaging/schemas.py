"""Pydantic schemas for chat rooms and messages (09-views-and-apis)."""
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class ChatRoomMemberSummary(BaseModel):
    user_id: UUID
    role: str
    display_name: str | None = None


class ChatRoomOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    room_id: UUID
    room_type: str
    transaction_id: UUID | None = None
    name: str | None = None
    created_at: datetime
    is_archived: bool


class ChatRoomCreate(BaseModel):
    room_type: str = Field(..., pattern="^(TRANSACTION|DIRECT|GROUP)$")
    transaction_id: UUID | None = None
    name: str | None = None
    member_user_ids: list[UUID] = Field(default_factory=list)


class ChatRoomUpdate(BaseModel):
    name: str | None = None
    is_archived: bool | None = None


class MessageOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    message_id: UUID
    room_id: UUID
    sender_id: UUID
    message_type: str
    content: str | None = None
    created_at: datetime
    is_deleted: bool


class MessageCreate(BaseModel):
    message_type: str = "TEXT"
    content: str | None = None
    content_json: dict | None = None
    reply_to_message_id: UUID | None = None


class MessageUpdate(BaseModel):
    content: str | None = None


class ChatAttachmentOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    attachment_id: UUID
    message_id: UUID
    file_name: str
    file_size_bytes: int
    mime_type: str


class PresignedUploadResponse(BaseModel):
    upload_url: str
    attachment_id: UUID
    expires_in_seconds: int = 3600


class AddMemberBody(BaseModel):
    user_id: UUID
