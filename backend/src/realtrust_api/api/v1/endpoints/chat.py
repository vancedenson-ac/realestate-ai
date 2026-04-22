"""Chat endpoints: rooms, messages, mark-read, attachments (09-views-and-apis)."""
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from realtrust_api.api.deps import get_db_with_rls, get_current_user_id
from realtrust_api.core.exceptions import not_found_exception
from realtrust_api.domain.messaging import models as m
from realtrust_api.domain.messaging import schemas as s

router = APIRouter()


@router.post("/rooms", response_model=s.ChatRoomOverview, status_code=status.HTTP_201_CREATED)
async def create_chat_room(
    body: s.ChatRoomCreate,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.ChatRoomOverview:
    """Create direct or group chat (TRANSACTION rooms require transaction_id). Uses DB helper so RLS sees app.user_id (set in same transaction)."""
    room_id = uuid4()
    result = await db.execute(
        text(
            "SELECT * FROM messaging.insert_chat_room("
            "CAST(:rid AS uuid), CAST(:rtype AS text), CAST(:txid AS uuid), CAST(:name AS text), CAST(:uid AS uuid)"
            ")"
        ),
        {
            "rid": str(room_id),
            "rtype": body.room_type,
            "txid": str(body.transaction_id) if body.transaction_id else None,
            "name": body.name,
            "uid": str(current_user_id),
        },
    )
    row = result.mappings().one()
    await db.execute(
        text(
            "SELECT messaging.insert_chat_room_member("
            "CAST(:rid AS uuid), CAST(:uid AS uuid), 'OWNER', CAST(:uid AS uuid))"
        ),
        {"rid": str(room_id), "uid": str(current_user_id)},
    )
    for uid in body.member_user_ids:
        if uid == current_user_id:
            continue
        await db.execute(
            text(
                "SELECT messaging.insert_chat_room_member("
                "CAST(:rid AS uuid), CAST(:member AS uuid), 'MEMBER', CAST(:uid AS uuid))"
            ),
            {"rid": str(room_id), "member": str(uid), "uid": str(current_user_id)},
        )
    return s.ChatRoomOverview.model_validate(dict(row))


@router.get("/rooms", response_model=list[s.ChatRoomOverview])
async def list_chat_rooms(
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.ChatRoomOverview]:
    """List user's chat rooms (RLS / member filter when auth is wired)."""
    sub = select(m.ChatRoomMember.room_id).where(m.ChatRoomMember.user_id == current_user_id)
    q = select(m.ChatRoom).where(m.ChatRoom.room_id.in_(sub)).order_by(m.ChatRoom.created_at.desc())
    result = await db.execute(q)
    rows = result.scalars().all()
    return [s.ChatRoomOverview.model_validate(r) for r in rows]


@router.get("/rooms/{room_id}", response_model=s.ChatRoomOverview)
async def get_chat_room(
    room_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.ChatRoomOverview:
    """Get room details and members."""
    result = await db.execute(select(m.ChatRoom).where(m.ChatRoom.room_id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise not_found_exception("ChatRoom", str(room_id))
    return s.ChatRoomOverview.model_validate(room)


@router.patch("/rooms/{room_id}", response_model=s.ChatRoomOverview)
async def update_chat_room(
    room_id: UUID,
    body: s.ChatRoomUpdate,
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.ChatRoomOverview:
    """Update room (name, archive)."""
    result = await db.execute(select(m.ChatRoom).where(m.ChatRoom.room_id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise not_found_exception("ChatRoom", str(room_id))
    update_data = body.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(room, k, v)
    await db.flush()
    await db.refresh(room)
    return s.ChatRoomOverview.model_validate(room)


@router.post("/rooms/{room_id}/members", status_code=status.HTTP_204_NO_CONTENT)
async def add_chat_room_member(
    room_id: UUID,
    body: s.AddMemberBody,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> None:
    """Add member to group chat (room creator only; enforced in DB helper)."""
    result = await db.execute(select(m.ChatRoom).where(m.ChatRoom.room_id == room_id))
    if not result.scalar_one_or_none():
        raise not_found_exception("ChatRoom", str(room_id))
    await db.execute(
        text(
            "SELECT messaging.insert_chat_room_member("
            "CAST(:rid AS uuid), CAST(:uid AS uuid), 'MEMBER', CAST(:added AS uuid))"
        ),
        {"rid": str(room_id), "uid": str(body.user_id), "added": str(current_user_id)},
    )


@router.delete("/rooms/{room_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_chat_room_member(
    room_id: UUID,
    user_id: UUID,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> None:
    """Remove member from room (room creator or the member themselves; enforced in DB helper)."""
    try:
        await db.execute(
            text(
                "SELECT messaging.delete_chat_room_member("
                "CAST(:rid AS uuid), CAST(:uid AS uuid), CAST(:removed AS uuid))"
            ),
            {"rid": str(room_id), "uid": str(user_id), "removed": str(current_user_id)},
        )
    except Exception as e:
        if "not found" in str(e).lower():
            raise not_found_exception("ChatRoomMember", str(user_id)) from e
        raise


@router.get("/rooms/{room_id}/messages", response_model=list[s.MessageOverview])
async def list_room_messages(
    room_id: UUID,
    cursor: UUID | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.MessageOverview]:
    """List messages in room (paginated)."""
    result = await db.execute(select(m.ChatRoom).where(m.ChatRoom.room_id == room_id))
    if not result.scalar_one_or_none():
        raise not_found_exception("ChatRoom", str(room_id))
    q = (
        select(m.Message)
        .where(m.Message.room_id == room_id)
        .order_by(m.Message.created_at.desc())
        .limit(min(limit, 100))
    )
    if cursor:
        q = q.where(m.Message.message_id < cursor)
    result = await db.execute(q)
    rows = result.scalars().all()
    return [s.MessageOverview.model_validate(msg) for msg in rows]


@router.post("/rooms/{room_id}/messages", response_model=s.MessageOverview, status_code=status.HTTP_201_CREATED)
async def send_message(
    room_id: UUID,
    body: s.MessageCreate,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.MessageOverview:
    """Send message (REST fallback)."""
    result = await db.execute(select(m.ChatRoom).where(m.ChatRoom.room_id == room_id))
    if not result.scalar_one_or_none():
        raise not_found_exception("ChatRoom", str(room_id))
    msg = m.Message(
        room_id=room_id,
        sender_id=current_user_id,
        message_type=body.message_type,
        content=body.content,
        content_json=body.content_json,
        reply_to_message_id=body.reply_to_message_id,
    )
    db.add(msg)
    await db.flush()
    await db.refresh(msg)
    return s.MessageOverview.model_validate(msg)


@router.patch("/messages/{message_id}", response_model=s.MessageOverview)
async def edit_message(
    message_id: UUID,
    body: s.MessageUpdate,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> s.MessageOverview:
    """Edit message content."""
    result = await db.execute(select(m.Message).where(m.Message.message_id == message_id))
    msg = result.scalar_one_or_none()
    if not msg:
        raise not_found_exception("Message", str(message_id))
    if msg.sender_id != current_user_id:
        raise not_found_exception("Message", str(message_id))
    if body.content is not None:
        msg.content = body.content
    from datetime import datetime, timezone
    msg.edited_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(msg)
    return s.MessageOverview.model_validate(msg)


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: UUID,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> None:
    """Soft delete message."""
    result = await db.execute(select(m.Message).where(m.Message.message_id == message_id))
    msg = result.scalar_one_or_none()
    if not msg:
        raise not_found_exception("Message", str(message_id))
    if msg.sender_id != current_user_id:
        raise not_found_exception("Message", str(message_id))
    msg.is_deleted = True
    await db.flush()


@router.post("/rooms/{room_id}/mark-read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_room_read(
    room_id: UUID,
    message_id: UUID | None = None,
    current_user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db_with_rls),
) -> None:
    """Mark messages as read for current user."""
    result = await db.execute(
        select(m.ChatRoomMember).where(
            m.ChatRoomMember.room_id == room_id,
            m.ChatRoomMember.user_id == current_user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise not_found_exception("ChatRoomMember", str(room_id))
    member.last_read_message_id = message_id
    await db.flush()


@router.post("/attachments/upload", response_model=s.PresignedUploadResponse)
async def chat_attachment_upload_url() -> s.PresignedUploadResponse:
    """Get presigned upload URL for chat attachment (stub)."""
    import uuid as _uuid
    aid = _uuid.uuid4()
    return s.PresignedUploadResponse(
        upload_url=f"https://stub.example.com/chat/upload?aid={aid}",
        attachment_id=aid,
        expires_in_seconds=3600,
    )


@router.get("/rooms/{room_id}/attachments", response_model=list[s.ChatAttachmentOverview])
async def list_room_attachments(
    room_id: UUID,
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[s.ChatAttachmentOverview]:
    """List attachments in room (messages that have attachments)."""
    result = await db.execute(select(m.ChatRoom).where(m.ChatRoom.room_id == room_id))
    if not result.scalar_one_or_none():
        raise not_found_exception("ChatRoom", str(room_id))
    msg_ids = await db.execute(select(m.Message.message_id).where(m.Message.room_id == room_id))
    ids = [r[0] for r in msg_ids.all()]
    if not ids:
        return []
    q = select(m.ChatAttachment).where(m.ChatAttachment.message_id.in_(ids))
    result = await db.execute(q)
    rows = result.scalars().all()
    return [s.ChatAttachmentOverview.model_validate(a) for a in rows]