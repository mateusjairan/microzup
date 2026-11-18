import time
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.application.events import (
    AttachmentReady,
    MessageCreated,
    MessageDeleted,
    MessageUpdated,
    NudgeSent,
    ReadUpdated,
    UserDeactivated,
)
from app.domain.entities.message import Message
from fastapi import WebSocket

PRESENCE_STATUSES = frozenset({"available", "busy", "away", "dnd", "invisible"})
STATUS_MESSAGE_MAX_CHARS = 120  # plano-frontend §3: recado de status
STATUS_MESSAGE_TTL_SECONDS = 8 * 3600.0  # expira em 8 h

DEACTIVATED_CLOSE_CODE = 4403


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
    """Conexões, fan-out e presença por usuário (vários sockets por usuário)."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._connections: dict[UUID, set[WebSocket]] = {}
        self._statuses: dict[UUID, str] = {}
        self._status_messages: dict[UUID, tuple[str, float]] = {}

    async def connect(self, user_id: UUID, websocket: WebSocket) -> None:
        self._connections.setdefault(user_id, set()).add(websocket)
        self._statuses.setdefault(user_id, "available")

    async def disconnect(self, user_id: UUID, websocket: WebSocket) -> None:
        sockets = self._connections.get(user_id)
        if sockets is not None:
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(user_id, None)
                self._statuses.pop(user_id, None)
                self._status_messages.pop(user_id, None)

    async def close_user(self, user_id: UUID, code: int = 1000) -> None:
        for websocket in list(self._connections.get(user_id, ())):
            with suppress(Exception):
                await websocket.close(code=code)
        self._connections.pop(user_id, None)
        self._statuses.pop(user_id, None)
        self._status_messages.pop(user_id, None)

    def online_user_ids(self) -> frozenset[UUID]:
        return frozenset(self._connections)

    def set_status(self, user_id: UUID, status: str) -> bool:
        if user_id not in self._connections or status not in PRESENCE_STATUSES:
            return False
        self._statuses[user_id] = status
        return True

    def set_status_message(self, user_id: UUID, message: str) -> bool:
        if user_id not in self._connections or len(message) > STATUS_MESSAGE_MAX_CHARS:
            return False
        self._status_messages[user_id] = (message, self._clock() + STATUS_MESSAGE_TTL_SECONDS)
        return True

    def clear_status_message(self, user_id: UUID) -> None:
        self._status_messages.pop(user_id, None)

    def status_of(self, user_id: UUID) -> str:
        if user_id not in self._connections:
            return "offline"
        status = self._statuses.get(user_id, "available")
        return "offline" if status == "invisible" else status

    def status_message_of(self, user_id: UUID) -> str | None:
        entry = self._status_messages.get(user_id)
        if entry is None:
            return None
        message, expires_at = entry
        if self._clock() >= expires_at:
            self._status_messages.pop(user_id, None)
            return None
        return message

    def status_message_expires_in(self, user_id: UUID) -> float | None:
        """Segundos restantes do recado (contrato `note_expires_at` do cliente)."""
        entry = self._status_messages.get(user_id)
        if entry is None:
            return None
        message, expires_at = entry
        if self._clock() >= expires_at:
            self._status_messages.pop(user_id, None)
            return None
        return max(0.0, expires_at - self._clock())

    def presence_snapshot(self) -> dict[str, str]:
        return {str(user_id): self.status_of(user_id) for user_id in self._connections}

    def status_messages_snapshot(self) -> dict[str, str]:
        return {
            str(user_id): message
            for user_id in list(self._status_messages)
            if (message := self.status_message_of(user_id)) is not None
        }

    def status_message_expires_in_snapshot(self) -> dict[str, float]:
        return {
            str(user_id): round(remaining, 1)
            for user_id in list(self._status_messages)
            if (remaining := self.status_message_expires_in(user_id)) is not None
        }

    def _presence_payload(self, user_id: UUID) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "user_id": str(user_id),
            "status": self.status_of(user_id),
        }
        status_message = self.status_message_of(user_id)
        if status_message is not None:
            payload["status_message"] = status_message
            # TTL restante em segundos: o cliente agenda a expiração local
            # (shape aditivo — `status_message` segue como campo principal).
            remaining = self.status_message_expires_in(user_id)
            if remaining is not None:
                payload["status_message_expires_in"] = round(remaining, 1)
        return payload

    async def broadcast_presence(self, user_id: UUID) -> None:
        await self.broadcast_all(
            {
                "type": "presence.changed",
                "seq": 0,
                "ts": _now(),
                "payload": self._presence_payload(user_id),
            }
        )

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
            payload = message_payload(event.message)
            payload["attachment_ids"] = [str(aid) for aid in event.attachment_ids]
            await self.send_to_users(
                event.recipient_ids,
                {
                    "type": "message.created",
                    "seq": event.message.seq,
                    "ts": _now(),
                    "payload": payload,
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
        elif isinstance(event, ReadUpdated):
            await self.send_to_users(
                event.recipient_ids,
                {
                    "type": "read.updated",
                    "seq": event.last_read_seq,
                    "ts": _now(),
                    "payload": {
                        "conversation_id": str(event.conversation_id),
                        "user_id": str(event.user_id),
                        "last_read_seq": event.last_read_seq,
                    },
                },
            )
        elif isinstance(event, UserDeactivated):
            # Desativação: sessões já revogadas no caso de uso; aqui fechamos os sockets.
            await self.close_user(event.user_id, code=DEACTIVATED_CLOSE_CODE)
        elif isinstance(event, AttachmentReady):
            await self.send_to_users(
                event.recipient_ids,
                {
                    "type": "attachment.ready",
                    "seq": 0,
                    "ts": _now(),
                    "payload": {
                        "attachment_id": str(event.attachment.id),
                        "has_thumbnail": event.attachment.thumbnail_path is not None,
                    },
                },
            )
        elif isinstance(event, NudgeSent):
            await self.send_to_users(
                event.recipient_ids,
                {
                    "type": "nudge",
                    "seq": 0,
                    "ts": _now(),
                    "payload": {
                        "conversation_id": str(event.conversation_id),
                        "sender_id": str(event.sender_id),
                        "sender_name": event.sender_name,
                    },
                },
            )
