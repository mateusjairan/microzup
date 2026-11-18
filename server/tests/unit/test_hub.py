from uuid import uuid4

from app.presentation.ws.hub import WebSocketHub


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)


async def test_connect_starts_available_and_disconnect_clears_status() -> None:
    hub = WebSocketHub()
    user_id = uuid4()
    socket = FakeSocket()

    await hub.connect(user_id, socket)
    assert hub.presence_snapshot() == {str(user_id): "available"}
    assert hub.status_of(user_id) == "available"

    await hub.disconnect(user_id, socket)
    assert hub.presence_snapshot() == {}
    assert hub.status_of(user_id) == "offline"


async def test_status_changes_are_visible_and_invisible_maps_to_offline() -> None:
    hub = WebSocketHub()
    user_id = uuid4()
    await hub.connect(user_id, FakeSocket())

    assert hub.set_status(user_id, "busy") is True
    assert hub.status_of(user_id) == "busy"

    assert hub.set_status(user_id, "invisible") is True
    assert hub.status_of(user_id) == "offline"

    assert hub.set_status(user_id, "online") is False
    assert hub.status_of(user_id) == "offline"


async def test_multiple_sockets_keep_status_until_last_disconnect() -> None:
    hub = WebSocketHub()
    user_id = uuid4()
    first = FakeSocket()
    second = FakeSocket()

    await hub.connect(user_id, first)
    await hub.connect(user_id, second)
    await hub.disconnect(user_id, first)

    assert hub.status_of(user_id) == "available"

    await hub.disconnect(user_id, second)
    assert hub.status_of(user_id) == "offline"
