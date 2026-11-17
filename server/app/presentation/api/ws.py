import secrets
import time
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

from app.presentation.deps import CurrentUserDep
from app.presentation.ws.hub import WebSocketHub

router = APIRouter(tags=["ws"])


def _now() -> str:
    return datetime.now(UTC).isoformat()


@router.post("/ws/ticket")
async def ws_ticket(request: Request, current: CurrentUserDep) -> dict[str, Any]:
    settings = request.app.state.settings
    tickets: dict[str, tuple[UUID, float]] = request.app.state.ws_tickets
    ticket = secrets.token_urlsafe(32)
    tickets[ticket] = (current.id, time.monotonic() + settings.ws_ticket_ttl_seconds)
    return {"ticket": ticket, "expires_in": settings.ws_ticket_ttl_seconds}


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

    await hub.connect(user_id, websocket)
    await hub.broadcast_all(
        {
            "type": "presence.changed",
            "seq": 0,
            "ts": _now(),
            "payload": {"user_id": str(user_id), "status": "online"},
        }
    )

    try:
        await websocket.send_json(
            {
                "type": "hello",
                "seq": 0,
                "ts": _now(),
                "payload": {"version": "0.1.0", "user_id": str(user_id)},
            }
        )
        while True:
            data = await websocket.receive_json()
            await _handle_client_message(websocket, hub, user_id, data)
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(user_id, websocket)
        await hub.broadcast_all(
            {
                "type": "presence.changed",
                "seq": 0,
                "ts": _now(),
                "payload": {"user_id": str(user_id), "status": "offline"},
            }
        )


async def _handle_client_message(
    websocket: WebSocket,
    hub: WebSocketHub,
    user_id: UUID,
    data: dict[str, Any],
) -> None:
    message_type = data.get("type")
    if message_type == "ping":
        await websocket.send_json({"type": "pong", "seq": 0, "ts": _now(), "payload": {}})
        return
    if message_type == "typing":
        await hub.broadcast_all(
            {
                "type": "typing",
                "seq": 0,
                "ts": _now(),
                "payload": {
                    "conversation_id": data.get("conversation_id"),
                    "user_id": str(user_id),
                    "is_typing": bool(data.get("is_typing")),
                },
            }
        )
