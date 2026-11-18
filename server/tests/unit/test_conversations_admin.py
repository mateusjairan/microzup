from datetime import UTC, datetime
from uuid import uuid4

import pytest
from app.application.use_cases.conversations import (
    GetConversationAudience,
    GetConversationAudienceCommand,
    ListChannels,
    ListConversationMembers,
    ListConversationMembersCommand,
    ListConversations,
    UpdateChannel,
    UpdateChannelCommand,
)
from app.application.use_cases.download_file import DownloadFile, DownloadFileCommand
from app.application.use_cases.ws_session import BuildWsHello, WsHelloCommand
from app.domain.entities.attachment import Attachment
from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.entities.message import Message, MessageBody
from app.domain.entities.sector import Sector
from app.domain.entities.user import User, Username
from app.domain.exceptions import AccessDeniedError, NotFoundError, ValidationError
from app.domain.policies.conversation_access import ConversationAccessPolicy
from app.domain.value_objects.file_name import FileName
from app.domain.value_objects.file_size import FileSize
from app.domain.value_objects.sha256 import Sha256

from tests.unit.fakes import (
    FakeAttachmentRepository,
    FakeConversationRepository,
    FakeEventBus,
    FakeFileStorage,
    FakeHasher,
    FakeMessageReadRepository,
    FakeMessageRepository,
    FakePresenceDirectory,
    FakeSectorRepository,
    FakeUnitOfWork,
    FakeUserRepository,
    FixedClock,
    audit_events,
)

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)


def make_user(username: str) -> User:
    return User.create(
        Username(username), username, "member", None, FakeHasher().hash("x" * 10), NOW
    )


def build_channel_stack():
    sectors = [Sector.create("Qualidade", None, NOW), Sector.create("Produção", None, NOW)]
    quality_channel = Conversation.create_channel(sectors[0].id, sectors[0].name, None, NOW)
    production_channel = Conversation.create_channel(sectors[1].id, sectors[1].name, None, NOW)
    ana = make_user("ana.souza")
    bruno = make_user("bruno.lima")

    members = [
        ConversationMember.create(quality_channel.id, ana.id, NOW),
        ConversationMember.create(quality_channel.id, bruno.id, NOW),
    ]
    archived = quality_channel.archive(NOW)
    conversations = FakeConversationRepository(
        conversations=[archived, production_channel], members=members
    )
    sector_repo = FakeSectorRepository(sectors=sectors)
    return {
        "sectors": sector_repo,
        "conversations": conversations,
        "ana": ana,
        "bruno": bruno,
        "quality": archived,
        "production": production_channel,
    }


async def test_list_channels_shows_sector_member_count_and_archived() -> None:
    stack = build_channel_stack()
    use_case = ListChannels(stack["conversations"], stack["sectors"])

    summaries = await use_case.execute()

    by_sector = {s.conversation.sector_id: s for s in summaries}
    quality = by_sector[stack["quality"].sector_id]
    assert quality.sector is not None and quality.sector.name == "Qualidade"
    assert quality.member_count == 2
    assert quality.conversation.archived_at == NOW

    production = by_sector[stack["production"].sector_id]
    assert production.conversation.archived_at is None
    assert production.member_count == 0


async def test_update_channel_renames_archives_and_audits() -> None:
    stack = build_channel_stack()
    bus = FakeEventBus()
    use_case = UpdateChannel(stack["conversations"], bus, FakeUnitOfWork(), FixedClock(NOW))

    renamed = await use_case.execute(
        UpdateChannelCommand(
            channel_id=stack["production"].id, actor_id=uuid4(), name="  Chão de Fábrica  "
        )
    )
    assert renamed.name == "Chão de Fábrica"
    records = audit_events(bus)
    assert records[0].action == "channel.update"
    assert records[0].metadata == {"name": "Chão de Fábrica"}

    archived = await use_case.execute(
        UpdateChannelCommand(channel_id=stack["production"].id, actor_id=uuid4(), archived=True)
    )
    assert archived.archived_at == NOW
    assert audit_events(bus)[1].metadata == {"archived": True}

    reopened = await use_case.execute(
        UpdateChannelCommand(channel_id=stack["production"].id, actor_id=uuid4(), archived=False)
    )
    assert reopened.archived_at is None


async def test_update_channel_validates_input() -> None:
    stack = build_channel_stack()
    use_case = UpdateChannel(
        stack["conversations"], FakeEventBus(), FakeUnitOfWork(), FixedClock(NOW)
    )

    with pytest.raises(NotFoundError):
        await use_case.execute(UpdateChannelCommand(channel_id=uuid4(), actor_id=uuid4()))
    with pytest.raises(NotFoundError):
        # DM não é canal
        dm = Conversation.create_dm(uuid4(), uuid4(), NOW)
        stack["conversations"].conversations.append(dm)
        await use_case.execute(UpdateChannelCommand(channel_id=dm.id, actor_id=uuid4()))
    with pytest.raises(ValidationError, match="2 e 120"):
        await use_case.execute(
            UpdateChannelCommand(channel_id=stack["production"].id, actor_id=uuid4(), name="x")
        )


async def test_get_conversation_a_requires_membership() -> None:
    stack = build_channel_stack()
    outsider = make_user("carla.dias")
    use_case = GetConversationAudience(stack["conversations"], ConversationAccessPolicy())

    audience = await use_case.execute(
        GetConversationAudienceCommand(
            conversation_id=stack["quality"].id, requester_id=stack["ana"].id
        )
    )
    assert audience == frozenset({stack["ana"].id, stack["bruno"].id})

    with pytest.raises(AccessDeniedError):
        await use_case.execute(
            GetConversationAudienceCommand(
                conversation_id=stack["quality"].id, requester_id=outsider.id
            )
        )


async def test_list_conversation_members_requires_membership_and_resolves_presence() -> None:
    stack = build_channel_stack()
    outsider = make_user("carla.dias")
    presence = FakePresenceDirectory(statuses={stack["ana"].id: "away"})

    use_case = ListConversationMembers(
        stack["conversations"],
        FakeUserRepository(users=[stack["ana"], stack["bruno"]]),
        ConversationAccessPolicy(),
        presence,
    )

    infos = await use_case.execute(
        ListConversationMembersCommand(
            conversation_id=stack["quality"].id, requester_id=stack["ana"].id
        )
    )
    by_user = {info.user.id: info for info in infos}
    assert set(by_user) == {stack["ana"].id, stack["bruno"].id}
    assert by_user[stack["ana"].id].presence == "away"
    assert by_user[stack["bruno"].id].presence == "offline"
    assert by_user[stack["ana"].id].conversation_role == "member"

    with pytest.raises(AccessDeniedError):
        await use_case.execute(
            ListConversationMembersCommand(
                conversation_id=stack["quality"].id, requester_id=outsider.id
            )
        )


async def test_download_file_serves_thumbnail_without_audit() -> None:
    ana, bruno = make_user("ana.souza"), make_user("bruno.lima")
    dm = Conversation.create_dm(ana.id, bruno.id, NOW)
    conversations = FakeConversationRepository(
        conversations=[dm],
        members=[
            ConversationMember.create(dm.id, ana.id, NOW),
            ConversationMember.create(dm.id, bruno.id, NOW),
        ],
    )
    message = Message.create(dm.id, ana.id, "c1", MessageBody("corpo"), NOW)
    messages = FakeMessageRepository()
    await messages.add(message)
    attachment = Attachment.create(
        uploader_id=ana.id,
        filename=FileName("foto.png"),
        mime_type="image/png",
        size_bytes=FileSize(10),
        sha256=Sha256("a" * 64),
        storage_path="files/2026/11/x",
        now=NOW,
        thumbnail_path="thumbs/2026/11/x.jpg",
    )
    attachment = attachment.link(message.id)
    attachments = FakeAttachmentRepository(attachments=[attachment])
    bus = FakeEventBus()
    storage = FakeFileStorage()
    use_case = DownloadFile(
        attachments,
        messages,
        conversations,
        ConversationAccessPolicy(),
        storage,
        bus,
    )

    _, path = await use_case.execute(
        DownloadFileCommand(attachment_id=attachment.id, actor_id=bruno.id, thumbnail=True)
    )
    assert path.name == "x.jpg"
    # Prévia inline não audita como download de arquivo.
    assert audit_events(bus) == []

    _, full = await use_case.execute(
        DownloadFileCommand(attachment_id=attachment.id, actor_id=bruno.id, ip="10.0.0.9")
    )
    assert full.name == "x"
    records = audit_events(bus)
    assert records[0].action == "file.download"
    assert records[0].ip == "10.0.0.9"
    assert records[0].metadata["filename"] == "foto.png"


async def test_download_file_requires_membership_and_thumbnail() -> None:
    ana, bruno = make_user("ana.souza"), make_user("bruno.lima")
    outsider = make_user("carla.dias")
    dm = Conversation.create_dm(ana.id, bruno.id, NOW)
    conversations = FakeConversationRepository(
        conversations=[dm],
        members=[
            ConversationMember.create(dm.id, ana.id, NOW),
            ConversationMember.create(dm.id, bruno.id, NOW),
        ],
    )
    messages = FakeMessageRepository()
    message = await messages.add(Message.create(dm.id, ana.id, "c1", MessageBody("corpo"), NOW))
    attachment = Attachment.create(
        uploader_id=ana.id,
        filename=FileName("sem-previa.txt"),
        mime_type="text/plain",
        size_bytes=FileSize(5),
        sha256=Sha256("b" * 64),
        storage_path="files/2026/11/y",
        now=NOW,
    ).link(message.id)
    attachments = FakeAttachmentRepository(attachments=[attachment])
    use_case = DownloadFile(
        attachments,
        messages,
        conversations,
        ConversationAccessPolicy(),
        FakeFileStorage(),
        FakeEventBus(),
    )

    with pytest.raises(AccessDeniedError):
        await use_case.execute(
            DownloadFileCommand(attachment_id=attachment.id, actor_id=outsider.id)
        )
    with pytest.raises(NotFoundError, match="Prévia"):
        await use_case.execute(
            DownloadFileCommand(attachment_id=attachment.id, actor_id=bruno.id, thumbnail=True)
        )
    with pytest.raises(NotFoundError):
        await use_case.execute(DownloadFileCommand(attachment_id=uuid4(), actor_id=bruno.id))


async def test_build_ws_hello_returns_user_and_subscriptions() -> None:
    ana, bruno = make_user("ana.souza"), make_user("bruno.lima")
    dm = Conversation.create_dm(ana.id, bruno.id, NOW)
    conversations = FakeConversationRepository(
        conversations=[dm],
        members=[
            ConversationMember.create(dm.id, ana.id, NOW),
            ConversationMember.create(dm.id, bruno.id, NOW),
        ],
    )
    users = FakeUserRepository(users=[ana, bruno])
    use_case = BuildWsHello(users, conversations)

    hello = await use_case.execute(WsHelloCommand(user_id=ana.id))
    assert hello.user.id == ana.id
    assert hello.conversation_ids == frozenset({dm.id})

    with pytest.raises(NotFoundError):
        await use_case.execute(WsHelloCommand(user_id=uuid4()))


async def test_list_conversations_resolves_peer_state() -> None:
    ana, bruno = make_user("ana.souza"), make_user("bruno.lima")
    dm = Conversation.create_dm(ana.id, bruno.id, NOW)
    conversations = FakeConversationRepository(
        conversations=[dm],
        members=[
            ConversationMember.create(dm.id, ana.id, NOW),
            ConversationMember.create(dm.id, bruno.id, NOW),
        ],
    )
    users = FakeUserRepository(users=[ana, bruno.with_active(False, NOW)])
    messages = FakeMessageRepository()
    reads = FakeMessageReadRepository()
    use_case = ListConversations(conversations, messages, reads, users)

    summaries = await use_case.execute(ana.id)
    assert summaries[0].peer_id == bruno.id
    assert summaries[0].peer_is_active is False
    assert summaries[0].last_message is None
    assert summaries[0].unread_count == 0
    assert summaries[0].last_read_seq == 0
