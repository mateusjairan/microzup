from datetime import UTC, datetime
from uuid import uuid4

import pytest
from app.application.use_cases.conversations import (
    OpenDirectMessage,
    OpenDirectMessageCommand,
)
from app.application.use_cases.messages import (
    DeleteMessage,
    DeleteMessageCommand,
    EditMessage,
    EditMessageCommand,
    MarkRead,
    MarkReadCommand,
    SendMessage,
    SendMessageCommand,
)
from app.domain.entities.conversation import (
    Conversation,
    ConversationFactory,
    ConversationMember,
)
from app.domain.entities.user import User, Username
from app.domain.exceptions import AccessDeniedError, NotFoundError, ValidationError
from app.domain.policies.conversation_access import ConversationAccessPolicy

from tests.unit.fakes import (
    FakeAttachmentRepository,
    FakeConversationRepository,
    FakeEventBus,
    FakeHasher,
    FakeMessageReadRepository,
    FakeMessageRepository,
    FakeUnitOfWork,
    FakeUserRepository,
    FixedClock,
    audit_events,
)

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)


def make_user(username: str) -> User:
    return User.create(
        Username(username), username, "member", None, FakeHasher().hash("x" * 10), NOW
    )


def make_dm_conversation(a: User, b: User) -> Conversation:
    return Conversation.create_dm(a.id, b.id, NOW)


def build_message_stack(a: User, b: User):
    conversation = make_dm_conversation(a, b)
    conversations = FakeConversationRepository(
        conversations=[conversation],
        members=[
            ConversationMember.create(conversation.id, a.id, NOW),
            ConversationMember.create(conversation.id, b.id, NOW),
        ],
    )
    messages = FakeMessageRepository()
    events = FakeEventBus()
    uow = FakeUnitOfWork()
    policy = ConversationAccessPolicy()
    return conversation, conversations, messages, events, uow, policy


def make_send_use_case(conversations, messages, events, uow, policy, **limits):
    return SendMessage(
        conversations,
        messages,
        FakeAttachmentRepository(),
        policy,
        events,
        uow,
        FixedClock(NOW),
        **limits,
    )


async def test_send_message_persists_and_publishes() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)

    use_case = make_send_use_case(conversations, messages, events, uow, policy)
    message = await use_case.execute(
        SendMessageCommand(
            conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="Olá!"
        )
    )

    assert message.seq == 1
    assert len(messages.messages) == 1
    assert events.events[0].recipient_ids == frozenset({a.id, b.id})


async def test_send_message_audits_without_body() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)

    use_case = make_send_use_case(conversations, messages, events, uow, policy)
    await use_case.execute(
        SendMessageCommand(
            conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="Segredo!"
        )
    )

    records = audit_events(events)
    assert len(records) == 1
    assert records[0].action == "message.send"
    assert records[0].actor_id == a.id
    assert records[0].metadata["client_id"] == "c1"
    # O corpo não é duplicado no audit de envio (só edit/delete/purge preservam).
    assert "Segredo!" not in str(records[0].metadata)


async def test_send_message_is_idempotent() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)

    use_case = make_send_use_case(conversations, messages, events, uow, policy)
    first = await use_case.execute(
        SendMessageCommand(
            conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="Olá!"
        )
    )
    second = await use_case.execute(
        SendMessageCommand(
            conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="Olá!"
        )
    )

    assert first.id == second.id
    assert len(messages.messages) == 1
    assert len(events.events) == 2  # MessageCreated + AuditRequested, uma vez só
    # Retry idempotente não reaudita.
    assert len(audit_events(events)) == 1


async def test_non_member_cannot_send() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    intruder = make_user("carla.dias")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)

    use_case = make_send_use_case(conversations, messages, events, uow, policy)
    with pytest.raises(AccessDeniedError):
        await use_case.execute(
            SendMessageCommand(
                conversation_id=conversation.id, sender_id=intruder.id, client_id="c1", body="oi"
            )
        )


async def test_send_to_missing_conversation_is_404() -> None:
    a = make_user("ana.souza")
    conversations = FakeConversationRepository()
    use_case = make_send_use_case(
        conversations,
        FakeMessageRepository(),
        FakeEventBus(),
        FakeUnitOfWork(),
        ConversationAccessPolicy(),
    )
    with pytest.raises(NotFoundError):
        await use_case.execute(
            SendMessageCommand(
                conversation_id=Conversation.create_channel(a.id, "x", None, NOW).id,
                sender_id=a.id,
                client_id="c1",
                body="oi",
            )
        )


async def test_send_message_max_chars_injected() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)

    use_case = make_send_use_case(conversations, messages, events, uow, policy, max_chars=10)
    with pytest.raises(ValidationError, match="10 caracteres"):
        await use_case.execute(
            SendMessageCommand(
                conversation_id=conversation.id,
                sender_id=a.id,
                client_id="c1",
                body="x" * 11,
            )
        )


async def test_send_message_blocks_archived_conversation() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)
    conversations.conversations[0] = conversation.archive(NOW)

    use_case = make_send_use_case(conversations, messages, events, uow, policy)
    with pytest.raises(AccessDeniedError, match="arquivada"):
        await use_case.execute(
            SendMessageCommand(
                conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="oi"
            )
        )


async def test_send_message_rejects_too_many_attachments() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)

    use_case = make_send_use_case(conversations, messages, events, uow, policy, max_attachments=2)
    with pytest.raises(ValidationError, match="2 anexos"):
        await use_case.execute(
            SendMessageCommand(
                conversation_id=conversation.id,
                sender_id=a.id,
                client_id="c1",
                body="muitos anexos",
                attachment_ids=frozenset(uuid4() for _ in range(3)),
            )
        )


async def test_edit_only_by_author_and_preserves_original_body_in_audit() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)
    send = make_send_use_case(conversations, messages, events, uow, policy)
    message = await send.execute(
        SendMessageCommand(
            conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="Versão 1"
        )
    )

    edit = EditMessage(conversations, messages, events, uow, FixedClock(NOW))
    with pytest.raises(NotFoundError):
        await edit.execute(EditMessageCommand(message_id=message.id, actor_id=b.id, body="mudou"))

    updated = await edit.execute(
        EditMessageCommand(message_id=message.id, actor_id=a.id, body="Editada")
    )
    assert updated.body == "Editada"
    assert updated.edited_at == NOW

    edit_record = next(r for r in audit_events(events) if r.action == "message.edit")
    assert edit_record.metadata["original_body"] == "Versão 1"


async def test_edit_respects_injected_max_chars() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)
    send = make_send_use_case(conversations, messages, events, uow, policy)
    message = await send.execute(
        SendMessageCommand(
            conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="curta"
        )
    )

    edit = EditMessage(conversations, messages, events, uow, FixedClock(NOW), max_chars=5)
    with pytest.raises(ValidationError):
        await edit.execute(EditMessageCommand(message_id=message.id, actor_id=a.id, body="x" * 6))


async def test_delete_soft_deletes_and_preserves_original_body_in_audit() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)
    send = make_send_use_case(conversations, messages, events, uow, policy)
    message = await send.execute(
        SendMessageCommand(
            conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="Original aqui"
        )
    )

    delete = DeleteMessage(conversations, messages, events, uow, FixedClock(NOW))
    deleted = await delete.execute(DeleteMessageCommand(message_id=message.id, actor_id=a.id))

    assert deleted.is_deleted
    assert deleted.body == "Mensagem removida"
    assert any(e.__class__.__name__ == "MessageDeleted" for e in events.events)

    delete_record = next(r for r in audit_events(events) if r.action == "message.delete")
    # Plano §5: o corpo original vive no audit_log, não no messages.
    assert delete_record.metadata["original_body"] == "Original aqui"
    assert messages.messages[0].body == "Mensagem removida"


async def test_open_dm_reuses_existing() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    users = FakeUserRepository(users=[a, b])
    conversations = FakeConversationRepository()
    uow = FakeUnitOfWork()
    use_case = OpenDirectMessage(conversations, users, uow, FixedClock(NOW))

    first = await use_case.execute(OpenDirectMessageCommand(actor_id=a.id, other_user_id=b.id))
    second = await use_case.execute(OpenDirectMessageCommand(actor_id=a.id, other_user_id=b.id))

    assert first.conversation.id == second.conversation.id
    assert first.peer_id == b.id
    assert first.peer_is_active is True
    assert len(conversations.conversations) == 1
    assert len(conversations.members) == 2


async def test_open_dm_requires_active_peer() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    inactive = b.with_active(False, NOW)
    users = FakeUserRepository(users=[a, inactive])
    use_case = OpenDirectMessage(
        FakeConversationRepository(), users, FakeUnitOfWork(), FixedClock(NOW)
    )

    with pytest.raises(ValidationError, match="desativado"):
        await use_case.execute(OpenDirectMessageCommand(actor_id=a.id, other_user_id=b.id))


async def test_open_dm_with_inactive_peer_returns_existing_conversation() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    users = FakeUserRepository(users=[a, b])
    conversations = FakeConversationRepository()
    use_case = OpenDirectMessage(conversations, users, FakeUnitOfWork(), FixedClock(NOW))

    first = await use_case.execute(OpenDirectMessageCommand(actor_id=a.id, other_user_id=b.id))
    users.users = [u if u.id != b.id else b.with_active(False, NOW) for u in users.users]

    again = await use_case.execute(OpenDirectMessageCommand(actor_id=a.id, other_user_id=b.id))
    # Histórico preservado: a DM existente continua, com o par marcado como inativo.
    assert again.conversation.id == first.conversation.id
    assert again.peer_is_active is False


async def test_open_dm_with_self_fails() -> None:
    a = make_user("ana.souza")
    use_case = OpenDirectMessage(
        FakeConversationRepository(),
        FakeUserRepository(users=[a]),
        FakeUnitOfWork(),
        FixedClock(NOW),
    )
    with pytest.raises(ValidationError):
        await use_case.execute(OpenDirectMessageCommand(actor_id=a.id, other_user_id=a.id))


async def test_conversation_factory_open_dm_creates_pair_with_dm_key() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, members = ConversationFactory.open_dm(a.id, b.id, NOW)

    ordered = sorted((str(a.id), str(b.id)))
    assert conversation.kind == "dm"
    assert conversation.dm_key == f"{ordered[0]}:{ordered[1]}"
    assert {m.user_id for m in members} == {a.id, b.id}
    assert all(m.conversation_id == conversation.id for m in members)
    assert all(m.left_at is None for m in members)

    with pytest.raises(ValidationError):
        ConversationFactory.open_dm(a.id, a.id, NOW)


async def test_conversation_factory_open_channel_has_no_members() -> None:
    a = make_user("ana.souza")
    channel = ConversationFactory.open_channel(a.id, "Qualidade", None, NOW)
    assert channel.kind == "channel"
    assert channel.sector_id == a.id
    assert channel.name == "Qualidade"


async def test_mark_read_upserts_and_publishes_read_updated() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)
    reads = FakeMessageReadRepository()
    send = make_send_use_case(conversations, messages, events, uow, policy)
    await send.execute(
        SendMessageCommand(
            conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="Olá!"
        )
    )
    events.events.clear()

    mark = MarkRead(conversations, reads, policy, uow, events)
    await mark.execute(
        MarkReadCommand(conversation_id=conversation.id, user_id=b.id, last_read_seq=1)
    )

    assert await messages.unread_count(conversation.id, 1) == 0
    assert await reads.get(conversation.id, b.id) == 1

    from app.application.events import ReadUpdated

    read_events = [e for e in events.events if isinstance(e, ReadUpdated)]
    assert len(read_events) == 1
    assert read_events[0].last_read_seq == 1
    assert read_events[0].user_id == b.id
    assert read_events[0].recipient_ids == frozenset({a.id, b.id})
