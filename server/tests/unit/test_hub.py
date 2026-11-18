from datetime import UTC, datetime
from uuid import uuid4

from app.application.events import (
    AttachmentReady,
    NudgeSent,
    ReadUpdated,
    UserDeactivated,
)
from app.domain.entities.attachment import Attachment
from app.domain.value_objects.file_name import FileName
from app.domain.value_objects.file_size import FileSize
from app.domain.value_objects.sha256 import Sha256
from app.presentation.api.ws import KeepalivePolicy
from app.presentation.ws.hub import WebSocketHub

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.closed_with: int | None = None

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    async def close(self, code: int = 1000) -> None:
        self.closed_with = code


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


async def test_status_message_lives_in_presence_payload_and_expires() -> None:
    clock = FakeClock()
    hub = WebSocketHub(clock=clock)
    user_id = uuid4()
    await hub.connect(user_id, FakeSocket())

    assert hub.set_status_message(user_id, "Em auditoria até 14h") is True
    assert hub.status_message_of(user_id) == "Em auditoria até 14h"
    assert hub.status_messages_snapshot() == {str(user_id): "Em auditoria até 14h"}

    # TTL restante visível no contrato (cliente agenda a expiração local).
    remaining = hub.status_message_expires_in(user_id)
    assert remaining is not None
    assert 7 * 3600 < remaining <= 8 * 3600
    expires_snapshot = hub.status_message_expires_in_snapshot()
    assert str(user_id) in expires_snapshot

    # Expira em 8 h.
    clock.advance(8 * 3600 + 1)
    assert hub.status_message_of(user_id) is None
    assert hub.status_messages_snapshot() == {}
    assert hub.status_message_expires_in_snapshot() == {}


async def test_presence_payload_carries_status_message_ttl() -> None:
    clock = FakeClock()
    hub = WebSocketHub(clock=clock)
    user_id = uuid4()
    socket = FakeSocket()
    await hub.connect(user_id, socket)
    hub.set_status_message(user_id, "Em reunião")

    await hub.broadcast_presence(user_id)

    payload = socket.sent[-1]["payload"]
    assert payload["status_message"] == "Em reunião"
    # TTL restante em segundos no payload (shape aditivo ao status_message).
    assert payload["status_message_expires_in"] == round(8 * 3600.0, 1)


async def test_status_message_rejects_over_120_chars() -> None:
    hub = WebSocketHub()
    user_id = uuid4()
    await hub.connect(user_id, FakeSocket())

    assert hub.set_status_message(user_id, "x" * 121) is False
    assert hub.set_status_message(user_id, "x" * 120) is True


async def test_clear_status_message() -> None:
    hub = WebSocketHub()
    user_id = uuid4()
    await hub.connect(user_id, FakeSocket())
    hub.set_status_message(user_id, "volto já")

    hub.clear_status_message(user_id)
    assert hub.status_message_of(user_id) is None


async def test_presence_payload_carries_status_message() -> None:
    hub = WebSocketHub()
    user_id = uuid4()
    socket = FakeSocket()
    await hub.connect(user_id, socket)
    hub.set_status(user_id, "busy")
    hub.set_status_message(user_id, "Em reunião")

    await hub.broadcast_presence(user_id)

    event = socket.sent[-1]
    assert event["type"] == "presence.changed"
    assert event["payload"]["status"] == "busy"
    assert event["payload"]["status_message"] == "Em reunião"


async def test_close_user_closes_all_sockets_with_code() -> None:
    hub = WebSocketHub()
    user_id = uuid4()
    first = FakeSocket()
    second = FakeSocket()
    await hub.connect(user_id, first)
    await hub.connect(user_id, second)

    await hub.close_user(user_id, code=4403)

    assert first.closed_with == 4403
    assert second.closed_with == 4403
    assert hub.status_of(user_id) == "offline"


async def test_on_event_user_deactivated_closes_sockets() -> None:
    hub = WebSocketHub()
    user_id = uuid4()
    socket = FakeSocket()
    await hub.connect(user_id, socket)

    await hub.on_event(UserDeactivated(user_id=user_id))

    assert socket.closed_with == 4403


async def test_on_event_read_updated_reaches_members_with_seq() -> None:
    hub = WebSocketHub()
    ana, bruno = uuid4(), uuid4()
    ana_socket, bruno_socket = FakeSocket(), FakeSocket()
    await hub.connect(ana, ana_socket)
    await hub.connect(bruno, bruno_socket)

    await hub.on_event(
        ReadUpdated(
            conversation_id=uuid4(),
            user_id=bruno,
            last_read_seq=42,
            recipient_ids=frozenset({ana, bruno}),
        )
    )

    event = ana_socket.sent[-1]
    assert event["type"] == "read.updated"
    assert event["seq"] == 42
    assert event["payload"]["last_read_seq"] == 42
    assert event["payload"]["user_id"] == str(bruno)
    assert bruno_socket.sent[-1]["type"] == "read.updated"


async def test_on_event_attachment_ready_notifies_uploader() -> None:
    hub = WebSocketHub()
    uploader = uuid4()
    socket = FakeSocket()
    await hub.connect(uploader, socket)

    attachment = Attachment.create(
        uploader_id=uploader,
        filename=FileName("grafico.png"),
        mime_type="image/png",
        size_bytes=FileSize(10),
        sha256=Sha256("a" * 64),
        storage_path="files/2026/11/x",
        now=NOW,
        thumbnail_path="thumbs/2026/11/x.jpg",
    )
    await hub.on_event(AttachmentReady(attachment, frozenset({uploader})))

    event = socket.sent[-1]
    assert event["type"] == "attachment.ready"
    assert event["payload"]["attachment_id"] == str(attachment.id)
    assert event["payload"]["has_thumbnail"] is True


async def test_on_event_nudge_sent_reaches_recipients() -> None:
    hub = WebSocketHub()
    sender, recipient = uuid4(), uuid4()
    recipient_socket = FakeSocket()
    await hub.connect(recipient, recipient_socket)

    await hub.on_event(
        NudgeSent(
            conversation_id=uuid4(),
            sender_id=sender,
            sender_name="Ana Souza",
            recipient_ids=frozenset({recipient}),
        )
    )

    event = recipient_socket.sent[-1]
    assert event["type"] == "nudge"
    assert event["payload"]["sender_name"] == "Ana Souza"


def test_keepalive_policy_sends_ping_at_25s_and_disconnects_at_60s() -> None:
    clock = FakeClock()
    policy = KeepalivePolicy(idle_timeout=60.0, keepalive_interval=25.0, clock=clock)

    assert policy.should_disconnect() is False
    assert policy.wait_seconds() == 25.0

    clock.advance(25.0)  # 25 s sem atividade → ping
    assert policy.should_disconnect() is False
    assert policy.wait_seconds() == 25.0

    clock.advance(25.0)  # 50 s → outro ping
    assert policy.should_disconnect() is False
    assert policy.wait_seconds() == 10.0

    clock.advance(10.0)  # 60 s sem heartbeat → desconecta
    assert policy.should_disconnect() is True
    assert policy.wait_seconds() == 0.0


def test_keepalive_policy_activity_resets_deadline() -> None:
    clock = FakeClock()
    policy = KeepalivePolicy(idle_timeout=60.0, keepalive_interval=25.0, clock=clock)

    clock.advance(59.0)
    assert policy.should_disconnect() is False

    policy.register_activity()  # heartbeat chegou no limite
    clock.advance(30.0)
    assert policy.should_disconnect() is False
    assert policy.wait_seconds() == 25.0
