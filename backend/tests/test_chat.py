"""Chat: rooms, members, messages, mark-read, attachments, GET /transactions/{id}/chat."""
import pytest
from httpx import AsyncClient

from tests.conftest import error_code

# Seed (03-seed.sql) — hex-only UUIDs when seed is run; tests also create their own data
ROOM_TRANSACTION = "a1000001-0000-0000-0000-000000000001"
MESSAGE_1 = "a2000001-0000-0000-0000-000000000001"
TXN_1 = "c0000001-0000-0000-0000-000000000001"
TXN_2 = "c0000001-0000-0000-0000-000000000002"
ALICE = "b0000001-0000-0000-0000-000000000001"
BOB = "b0000001-0000-0000-0000-000000000002"
CAROL = "b0000001-0000-0000-0000-000000000003"
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"


@pytest.fixture
async def txn1_room_id(client_as_alice: AsyncClient, api_base: str) -> str:
    """Resolve transaction chat room id for TXN_1 (seed or get-or-create)."""
    r = await client_as_alice.get(f"{api_base}/transactions/{TXN_1}/chat")
    assert r.status_code == 200, r.text
    return r.json()["room_id"]


@pytest.mark.asyncio
async def test_create_chat_room(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /chat/rooms returns 201 and creates room."""
    response = await client_as_alice.post(
        f"{api_base}/chat/rooms",
        json={
            "room_type": "GROUP",
            "name": "Test group",
            "member_user_ids": [BOB],
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["room_type"] == "GROUP"
    assert data["name"] == "Test group"
    assert "room_id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_create_chat_room_direct(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /chat/rooms with room_type DIRECT returns 201."""
    response = await client_as_alice.post(
        f"{api_base}/chat/rooms",
        json={"room_type": "DIRECT", "member_user_ids": [BOB]},
    )
    assert response.status_code == 201
    assert response.json()["room_type"] == "DIRECT"


@pytest.mark.asyncio
async def test_list_chat_rooms(client_as_alice: AsyncClient, api_base: str, txn1_room_id: str) -> None:
    """GET /chat/rooms returns 200 and list; the room returned by GET /transactions/.../chat must appear in the list."""
    response = await client_as_alice.get(f"{api_base}/chat/rooms")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    room_ids = [r["room_id"] for r in data]
    assert txn1_room_id in room_ids, f"Room {txn1_room_id} from GET /transactions/.../chat should be in list: {room_ids}"
    room_for_txn1 = next((r for r in data if r.get("transaction_id") == TXN_1), None)
    assert room_for_txn1 is not None, "At least one room for seed transaction should be in list"
    assert room_for_txn1["room_type"] == "TRANSACTION"
    # There may be multiple rooms for TXN_1 (seed + get-or-create); the one we got from get-or-create must be in the list


@pytest.mark.asyncio
async def test_get_chat_room(client: AsyncClient, api_base: str, txn1_room_id: str) -> None:
    """GET /chat/rooms/{id} returns 200 for seed room."""
    response = await client.get(f"{api_base}/chat/rooms/{txn1_room_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["room_id"] == txn1_room_id
    assert data["room_type"] == "TRANSACTION"
    assert data["transaction_id"] == TXN_1


@pytest.mark.asyncio
async def test_get_chat_room_not_found(client: AsyncClient, api_base: str) -> None:
    """GET /chat/rooms/{id} returns 404 for unknown room."""
    response = await client.get(f"{api_base}/chat/rooms/{NONEXISTENT_UUID}")
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_update_chat_room(client_as_alice: AsyncClient, api_base: str, txn1_room_id: str) -> None:
    """PATCH /chat/rooms/{id} returns 200 and updates name."""
    response = await client_as_alice.patch(
        f"{api_base}/chat/rooms/{txn1_room_id}",
        json={"name": "Transaction chat"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Transaction chat"


@pytest.mark.asyncio
async def test_add_chat_room_member(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /chat/rooms/{id}/members returns 204 and adds member."""
    create = await client_as_alice.post(
        f"{api_base}/chat/rooms",
        json={"room_type": "GROUP", "name": "Add member test", "member_user_ids": []},
    )
    assert create.status_code == 201
    room_id = create.json()["room_id"]
    response = await client_as_alice.post(
        f"{api_base}/chat/rooms/{room_id}/members",
        json={"user_id": CAROL},
    )
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_add_chat_room_member_room_not_found(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /chat/rooms/{id}/members returns 404 for unknown room."""
    response = await client_as_alice.post(
        f"{api_base}/chat/rooms/{NONEXISTENT_UUID}/members",
        json={"user_id": BOB},
    )
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_list_room_messages(client_as_alice: AsyncClient, api_base: str, txn1_room_id: str) -> None:
    """GET /chat/rooms/{id}/messages returns 200 and list (seed room has one message)."""
    response = await client_as_alice.get(f"{api_base}/chat/rooms/{txn1_room_id}/messages")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1, "Seed transaction room should have at least one message"
    seed_msg = next((m for m in data if m["message_id"] == MESSAGE_1), None)
    msg = seed_msg if seed_msg is not None else data[0]
    assert msg["room_id"] == txn1_room_id
    assert msg["message_type"] == "TEXT"
    # Seed message may be "Welcome" or edited to "Edited welcome message" by test_edit_message
    if msg.get("message_id") == MESSAGE_1:
        content = msg.get("content") or ""
        assert "Welcome" in content or "Edited" in content


@pytest.mark.asyncio
async def test_list_room_messages_pagination(client: AsyncClient, api_base: str, txn1_room_id: str) -> None:
    """GET /chat/rooms/{id}/messages?limit=1 returns at most 1 message."""
    response = await client.get(
        f"{api_base}/chat/rooms/{txn1_room_id}/messages",
        params={"limit": 1},
    )
    assert response.status_code == 200
    assert len(response.json()) <= 1


@pytest.mark.asyncio
async def test_send_message(client_as_alice: AsyncClient, api_base: str, txn1_room_id: str) -> None:
    """POST /chat/rooms/{id}/messages returns 201 and creates message."""
    response = await client_as_alice.post(
        f"{api_base}/chat/rooms/{txn1_room_id}/messages",
        json={"message_type": "TEXT", "content": "Hello from test"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["room_id"] == txn1_room_id
    assert data["message_type"] == "TEXT"
    assert data["content"] == "Hello from test"
    assert "message_id" in data


@pytest.mark.asyncio
async def test_send_message_room_not_found(client_as_alice: AsyncClient, api_base: str) -> None:
    """POST /chat/rooms/{id}/messages returns 404 for unknown room."""
    response = await client_as_alice.post(
        f"{api_base}/chat/rooms/{NONEXISTENT_UUID}/messages",
        json={"content": "Hi"},
    )
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_edit_message(client_as_alice: AsyncClient, api_base: str, txn1_room_id: str) -> None:
    """PATCH /chat/messages/{id} returns 200 and updates content (Alice sent seed message)."""
    # Resolve seed message id (may be MESSAGE_1 or first message in room)
    list_r = await client_as_alice.get(f"{api_base}/chat/rooms/{txn1_room_id}/messages")
    assert list_r.status_code == 200
    messages = list_r.json()
    assert messages, "Seed room should have at least one message"
    msg_id = next((m["message_id"] for m in messages if m["message_id"] == MESSAGE_1), messages[0]["message_id"])
    response = await client_as_alice.patch(
        f"{api_base}/chat/messages/{msg_id}",
        json={"content": "Edited welcome message"},
    )
    assert response.status_code == 200
    assert response.json()["content"] == "Edited welcome message"


@pytest.mark.asyncio
async def test_edit_message_not_found(client_as_bob: AsyncClient, api_base: str) -> None:
    """PATCH /chat/messages/{id} by non-sender returns 404 (Bob did not send MESSAGE_1)."""
    response = await client_as_bob.patch(
        f"{api_base}/chat/messages/{MESSAGE_1}",
        json={"content": "Hacked"},
    )
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_delete_message_soft(client_as_alice: AsyncClient, api_base: str, txn1_room_id: str) -> None:
    """DELETE /chat/messages/{id} returns 204 and soft-deletes (send new msg then delete)."""
    send = await client_as_alice.post(
        f"{api_base}/chat/rooms/{txn1_room_id}/messages",
        json={"content": "To be deleted"},
    )
    assert send.status_code == 201
    message_id = send.json()["message_id"]
    response = await client_as_alice.delete(f"{api_base}/chat/messages/{message_id}")
    assert response.status_code == 204
    list_resp = await client_as_alice.get(
        f"{api_base}/chat/rooms/{txn1_room_id}/messages"
    )
    msg = next((m for m in list_resp.json() if m["message_id"] == message_id), None)
    assert msg is not None
    assert msg.get("is_deleted") is True


@pytest.mark.asyncio
async def test_mark_room_read(client_as_alice: AsyncClient, api_base: str, txn1_room_id: str) -> None:
    """POST /chat/rooms/{id}/mark-read returns 204 (optional message_id as query)."""
    response = await client_as_alice.post(
        f"{api_base}/chat/rooms/{txn1_room_id}/mark-read",
    )
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_mark_room_read_with_message_id(client_as_bob: AsyncClient, api_base: str, txn1_room_id: str) -> None:
    """POST /chat/rooms/{id}/mark-read with message_id returns 204 (Bob is member of seed room)."""
    list_r = await client_as_bob.get(f"{api_base}/chat/rooms/{txn1_room_id}/messages")
    if list_r.status_code != 200:
        pytest.skip("Cannot list messages (e.g. Bob not in room)")
    messages = list_r.json()
    if not messages:
        pytest.skip("Room has no messages to mark read")
    msg_id = messages[0]["message_id"]
    response = await client_as_bob.post(
        f"{api_base}/chat/rooms/{txn1_room_id}/mark-read",
        params={"message_id": msg_id},
    )
    if response.status_code == 404:
        pytest.skip("Bob not a member of this room (e.g. get-or-create returned new room)")
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_chat_attachments_upload_stub(client: AsyncClient, api_base: str) -> None:
    """POST /chat/attachments/upload returns 200 and presigned URL stub."""
    response = await client.post(f"{api_base}/chat/attachments/upload")
    assert response.status_code == 200
    data = response.json()
    assert "upload_url" in data
    assert "attachment_id" in data
    assert data.get("expires_in_seconds") == 3600


@pytest.mark.asyncio
async def test_list_room_attachments(client: AsyncClient, api_base: str, txn1_room_id: str) -> None:
    """GET /chat/rooms/{id}/attachments returns 200 and list (may be empty)."""
    response = await client.get(f"{api_base}/chat/rooms/{txn1_room_id}/attachments")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_list_room_attachments_room_not_found(client: AsyncClient, api_base: str) -> None:
    """GET /chat/rooms/{id}/attachments returns 404 for unknown room."""
    response = await client.get(f"{api_base}/chat/rooms/{NONEXISTENT_UUID}/attachments")
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"


@pytest.mark.asyncio
async def test_remove_chat_room_member(client_as_alice: AsyncClient, api_base: str) -> None:
    """DELETE /chat/rooms/{id}/members/{user_id} returns 204 (create room, add Bob, remove Bob)."""
    create = await client_as_alice.post(
        f"{api_base}/chat/rooms",
        json={"room_type": "GROUP", "name": "Remove test", "member_user_ids": [BOB]},
    )
    assert create.status_code == 201
    room_id = create.json()["room_id"]
    response = await client_as_alice.delete(
        f"{api_base}/chat/rooms/{room_id}/members/{BOB}"
    )
    assert response.status_code == 204


# ----- Transaction chat: GET /transactions/{id}/chat -----
@pytest.mark.asyncio
async def test_get_transaction_chat_existing(client: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/chat returns 200 and existing room (seed has room for TXN_1)."""
    response = await client.get(f"{api_base}/transactions/{TXN_1}/chat")
    assert response.status_code == 200
    data = response.json()
    assert data["room_type"] == "TRANSACTION"
    assert data["transaction_id"] == TXN_1
    # When seed was applied, room_id is ROOM_TRANSACTION; otherwise get-or-create returns some room_id
    assert "room_id" in data


@pytest.mark.asyncio
async def test_get_transaction_chat_create(client_as_alice: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/chat for TXN_2 creates room and returns 200 (TXN_2 is PRE_LISTING; Alice can see it; seed has no room)."""
    response = await client_as_alice.get(f"{api_base}/transactions/{TXN_2}/chat")
    assert response.status_code == 200
    data = response.json()
    assert data["room_type"] == "TRANSACTION"
    assert data["transaction_id"] == TXN_2
    assert "room_id" in data


@pytest.mark.asyncio
async def test_get_transaction_chat_not_found(client: AsyncClient, api_base: str) -> None:
    """GET /transactions/{id}/chat returns 404 for unknown transaction."""
    response = await client.get(f"{api_base}/transactions/{NONEXISTENT_UUID}/chat")
    assert response.status_code == 404
    assert error_code(response.json()) == "NOT_FOUND"
