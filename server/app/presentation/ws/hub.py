from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.application.events import MessageCreated, MessageDeleted, MessageUpdated
from app.domain.entities.message import Message
from fastapi import WebSocket


def _now() -> str:
    return datetime.now(UTC).isoformat()


def message_payload(message: Message) -> dict[str, Any]:
    return {
        "id": str(message.id),
        "seq": message.seq,
        "conversation_id": str(message.conversation_id),
        "sender_id": str(message.sender_id),
        "client_id": message.client_id,
        "body": message.body,
        "created_at": message.created_at.isoformat(),
        "edited_at": message.edited_at.isoformat() if message.edited_at else None,
        "deleted_at": message.deleted_at.isoformat() if message.deleted_at else None,
    }


class WebSocketHub:
    def __init__(self) -> None:
        self._connections: dict[UUID, set[WebSocket]] = {}

    async def connect(self, user_id: UUID, websocket: WebSocket) -> None:
        self._connections.setdefault(user_id, set()).add(websocket)

    async def disconnect(self, user_id: UUID, websocket: WebSocket) -> None:
        sockets = self._connections.get(user_id)
        if sockets is not None:
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(user_id, None)

    def online_user_ids(self) -> frozenset[UUID]:
        return frozenset(self._connections)

    async def send_to_users(self, user_ids: frozenset[UUID], payload: dict[str, Any]) -> None:
        for user_id in user_ids:
            for websocket in self._connections.get(user_id, ()):
                await websocket.send_json(payload)

    async def broadcast_all(self, payload: dict[str, Any]) -> None:
        for sockets in self._connections.values():
            for websocket in sockets:
                await websocket.send_json(payload)

    async def on_event(self, event: object) -> None:
        if isinstance(event, MessageCreated):
            await self.send_to_users(
                event.recipient_ids,
                {
                    "type": "message.created",
                    "seq": event.message.seq,
                    "ts": _now(),
                    "payload": message_payload(event.message),
                },
            )
        elif isinstance(event, MessageUpdated):
            await self.send_to_users(
                event.recipient_ids,
                {
                    "type": "message.updated",
                    "seq": event.message.seq,
                    "ts": _now(),
                    "payload": message_payload(event.message),
                },
            )
        elif isinstance(event, MessageDeleted):
            await self.send_to_users(
                event.recipient_ids,
                {
                    "type": "message.deleted",
                    "seq": 0,
                    "ts": _now(),
                    "payload": {
                        "conversation_id": str(event.conversation_id),
                        "message_id": str(event.message_id),
                    },
                },
            )
