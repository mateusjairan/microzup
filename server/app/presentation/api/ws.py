import asyncio
import secrets
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.use_cases.conversations import (
    GetConversationAudience,
    GetConversationAudienceCommand,
)
from app.application.use_cases.nudge import NudgeCommand, NudgeResult, SendNudge
from app.application.use_cases.ws_session import BuildWsHello, WsHelloCommand
from app.domain.exceptions import DomainError
from app.domain.policies.conversation_access import ConversationAccessPolicy
from app.domain.ports.events import EventBus
from app.domain.ports.throttling import RateLimiter
from app.infrastructure.db.repositories.conversations import SqlAlchemyConversationRepository
from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
from app.presentation.deps import CurrentUserDep
from app.presentation.ws.hub import STATUS_MESSAGE_MAX_CHARS, WebSocketHub

router = APIRouter(tags=["ws"])

SERVER_CLOSE_IDLE = 4408  # sem heartbeat por 60 s
IDLE_TIMEOUT_SECONDS = 60.0  # cliente bate coração a cada 30 s (plano-frontend §8.3)
KEEPALIVE_INTERVAL_SECONDS = 25.0


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _envelope(message_type: str, payload: dict[str, Any], seq: int = 0) -> dict[str, Any]:
    return {"type": message_type, "seq": seq, "ts": _now(), "payload": payload}


class KeepalivePolicy:
    """Keepalive ping/pong 25 s; sem heartbeat por 60 s o servidor derruba a conexão."""

    def __init__(
        self,
        idle_timeout: float = IDLE_TIMEOUT_SECONDS,
        keepalive_interval: float = KEEPALIVE_INTERVAL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.idle_timeout = idle_timeout
        self.keepalive_interval = keepalive_interval
        self._clock = clock
        self._last_activity = clock()

    def register_activity(self) -> None:
        self._last_activity = self._clock()

    def idle_seconds(self) -> float:
        return self._clock() - self._last_activity

    def wait_seconds(self) -> float:
        remaining = self.idle_timeout - self.idle_seconds()
        if remaining <= 0:
            return 0.0
        return min(self.keepalive_interval, remaining)

    def should_disconnect(self) -> bool:
        return self.idle_seconds() >= self.idle_timeout


@router.post("/ws/ticket")
async def ws_ticket(request: Request, current: CurrentUserDep) -> dict[str, Any]:
    settings = request.app.state.settings
    tickets: dict[str, tuple[UUID, float]] = request.app.state.ws_tickets
    ticket = secrets.token_urlsafe(32)
    tickets[ticket] = (current.id, time.monotonic() + settings.ws_ticket_ttl_seconds)
    return {"ticket": ticket, "expires_in": settings.ws_ticket_ttl_seconds}


def _parse_conversation_id(data: dict[str, Any]) -> UUID | None:
    raw = data.get("conversation_id")
    if not isinstance(raw, str):
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


async def _audience_of(
    app_state: Any, requester_id: UUID, conversation_id: UUID
) -> frozenset[UUID]:
    factory = cast(async_sessionmaker[AsyncSession], app_state.session_factory)
    async with factory() as session:
        use_case = GetConversationAudience(
            conversations=SqlAlchemyConversationRepository(session),
            policy=ConversationAccessPolicy(),
        )
        return await use_case.execute(
            GetConversationAudienceCommand(
                conversation_id=conversation_id, requester_id=requester_id
            )
        )


async def _send_nudge(
    app_state: Any, hub: WebSocketHub, sender_id: UUID, conversation_id: UUID
) -> NudgeResult:
    factory = cast(async_sessionmaker[AsyncSession], app_state.session_factory)
    async with factory() as session:
        use_case = SendNudge(
            conversations=SqlAlchemyConversationRepository(session),
            users=SqlAlchemyUserRepository(session),
            presence=hub,
            throttle=cast(RateLimiter, app_state.nudge_throttle),
            events=cast(EventBus, app_state.event_bus),
        )
        return await use_case.execute(
            NudgeCommand(conversation_id=conversation_id, sender_id=sender_id)
        )


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()

    ticket = websocket.query_params.get("ticket")
    if ticket is None:
        await websocket.close(code=4401)
        return

    tickets: dict[str, tuple[UUID, float]] = websocket.app.state.ws_tickets
    entry = tickets.pop(ticket, None)
    if entry is None or time.monotonic() > entry[1]:
        await websocket.close(code=4401)
        return

    user_id = entry[0]
    hub: WebSocketHub = websocket.app.state.hub

    factory = cast(async_sessionmaker[AsyncSession], websocket.app.state.session_factory)
    try:
        async with factory() as session:
            hello = await BuildWsHello(
                users=SqlAlchemyUserRepository(session),
                conversations=SqlAlchemyConversationRepository(session),
            ).execute(WsHelloCommand(user_id=user_id))
    except DomainError:
        await websocket.close(code=4401)
        return

    await hub.connect(user_id, websocket)
    await websocket.send_json(
        {
            "type": "hello",
            "seq": 0,
            "ts": _now(),
            "payload": {
                "version": websocket.app.state.version,
                "user": {
                    "id": str(hello.user.id),
                    "username": hello.user.username,
                    "display_name": hello.user.display_name,
                },
                "subscriptions": sorted(str(cid) for cid in hello.conversation_ids),
                "presence": hub.presence_snapshot(),
                "status_messages": hub.status_messages_snapshot(),
                "status_message_expires_in": hub.status_message_expires_in_snapshot(),
            },
        }
    )
    await hub.broadcast_presence(user_id)

    keepalive = KeepalivePolicy()
    try:
        while True:
            wait = keepalive.wait_seconds()
            if wait <= 0 or keepalive.should_disconnect():
                await websocket.close(code=SERVER_CLOSE_IDLE)
                break
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=wait)
            except TimeoutError:
                if keepalive.should_disconnect():
                    await websocket.close(code=SERVER_CLOSE_IDLE)
                    break
                await websocket.send_json(_envelope("ping", {}))
                continue
            keepalive.register_activity()
            await _handle_client_message(websocket, hub, user_id, data)
    except WebSocketDisconnect:
        pass
    finally:
        was_online = user_id in hub.online_user_ids()
        await hub.disconnect(user_id, websocket)
        if was_online and user_id not in hub.online_user_ids():
            await hub.broadcast_presence(user_id)


async def _handle_client_message(
    websocket: WebSocket,
    hub: WebSocketHub,
    user_id: UUID,
    data: dict[str, Any],
) -> None:
    message_type = data.get("type")

    if message_type == "ping":
        await websocket.send_json(_envelope("pong", {}))
        return

    if message_type == "presence.set":
        status = data.get("status")
        if isinstance(status, str) and hub.set_status(user_id, status):
            status_message = data.get("status_message")
            if isinstance(status_message, str):
                if status_message.strip():
                    if len(status_message) > STATUS_MESSAGE_MAX_CHARS:
                        await websocket.send_json(
                            _envelope(
                                "error",
                                {
                                    "code": "status_message_too_long",
                                    "message": (
                                        f"O recado de status aceita até "
                                        f"{STATUS_MESSAGE_MAX_CHARS} caracteres."
                                    ),
                                },
                            )
                        )
                        return
                    hub.set_status_message(user_id, status_message.strip())
                else:
                    hub.clear_status_message(user_id)
            await hub.broadcast_presence(user_id)
        else:
            await websocket.send_json(
                _envelope(
                    "error",
                    {
                        "code": "invalid_status",
                        "message": "Status inválido; use available, busy, away, dnd ou invisible.",
                    },
                )
            )
        return

    if message_type == "typing":
        conversation_id = _parse_conversation_id(data)
        if conversation_id is None:
            return
        try:
            audience = await _audience_of(websocket.app.state, user_id, conversation_id)
        except DomainError:
            return  # não é membro: evento descartado, sem eco para a rede
        # Correção do bug: typing era GLOBAL; agora vai apenas aos membros da conversa.
        await hub.send_to_users(
            audience,
            _envelope(
                "typing",
                {
                    "conversation_id": str(conversation_id),
                    "user_id": str(user_id),
                    "is_typing": bool(data.get("is_typing")),
                },
            ),
        )
        return

    if message_type == "nudge":
        conversation_id = _parse_conversation_id(data)
        if conversation_id is None:
            return
        try:
            result = await _send_nudge(websocket.app.state, hub, user_id, conversation_id)
        except DomainError as exc:
            await websocket.send_json(
                _envelope(
                    "nudge.refused",
                    {"conversation_id": str(conversation_id), "reason": exc.code},
                )
            )
            return
        if not result.delivered:
            await websocket.send_json(
                _envelope(
                    "nudge.refused",
                    {"conversation_id": str(conversation_id), "reason": result.reason},
                )
            )
        return
