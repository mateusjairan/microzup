from datetime import UTC, datetime

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
from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.entities.user import User, Username
from app.domain.exceptions import AccessDeniedError, NotFoundError, ValidationError
from app.domain.policies.conversation_access import ConversationAccessPolicy

from tests.unit.fakes import (
    FakeConversationRepository,
    FakeEventBus,
    FakeHasher,
    FakeMessageReadRepository,
    FakeMessageRepository,
    FakeUnitOfWork,
    FakeUserRepository,
    FixedClock,
)

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)


def make_user(username: str) -> User:
    return User.create(
        Username(username), username, "member", None, FakeHasher().hash("x" * 10), NOW
    )


def make_dm_conversation(a: User, b: User) -> Conversation:
    conversation = Conversation.create_dm(a.id, b.id, NOW)
    return conversation


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


async def test_send_message_persists_and_publishes() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)

    use_case = SendMessage(conversations, messages, policy, events, uow, FixedClock(NOW))
    message = await use_case.execute(
        SendMessageCommand(
            conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="Olá!"
        )
    )

    assert message.seq == 1
    assert len(messages.messages) == 1
    assert events.events[0].recipient_ids == frozenset({a.id, b.id})


async def test_send_message_is_idempotent() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)

    use_case = SendMessage(conversations, messages, policy, events, uow, FixedClock(NOW))
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
    assert len(events.events) == 1


async def test_non_member_cannot_send() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    intruder = make_user("carla.dias")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)

    use_case = SendMessage(conversations, messages, policy, events, uow, FixedClock(NOW))
    with pytest.raises(AccessDeniedError):
        await use_case.execute(
            SendMessageCommand(
                conversation_id=conversation.id, sender_id=intruder.id, client_id="c1", body="oi"
            )
        )


async def test_edit_only_by_author() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)
    send = SendMessage(conversations, messages, policy, events, uow, FixedClock(NOW))
    message = await send.execute(
        SendMessageCommand(
            conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="Olá!"
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


async def test_delete_soft_deletes_and_publishes() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)
    send = SendMessage(conversations, messages, policy, events, uow, FixedClock(NOW))
    message = await send.execute(
        SendMessageCommand(
            conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="Olá!"
        )
    )

    delete = DeleteMessage(conversations, messages, events, uow, FixedClock(NOW))
    deleted = await delete.execute(DeleteMessageCommand(message_id=message.id, actor_id=a.id))

    assert deleted.is_deleted
    assert deleted.body == "Mensagem removida"
    assert any(e.__class__.__name__ == "MessageDeleted" for e in events.events)


async def test_open_dm_reuses_existing() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    users = FakeUserRepository(users=[a, b])
    conversations = FakeConversationRepository()
    uow = FakeUnitOfWork()
    use_case = OpenDirectMessage(conversations, users, uow, FixedClock(NOW))

    first = await use_case.execute(OpenDirectMessageCommand(actor_id=a.id, other_user_id=b.id))
    second = await use_case.execute(OpenDirectMessageCommand(actor_id=a.id, other_user_id=b.id))

    assert first.id == second.id
    assert len(conversations.conversations) == 1
    assert len(conversations.members) == 2


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


async def test_mark_read_and_unread_count() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, conversations, messages, events, uow, policy = build_message_stack(a, b)
    reads = FakeMessageReadRepository()
    send = SendMessage(conversations, messages, policy, events, uow, FixedClock(NOW))
    await send.execute(
        SendMessageCommand(
            conversation_id=conversation.id, sender_id=a.id, client_id="c1", body="Olá!"
        )
    )

    mark = MarkRead(conversations, reads, policy, uow)
    await mark.execute(
        MarkReadCommand(conversation_id=conversation.id, user_id=b.id, last_read_seq=1)
    )

    assert await messages.unread_count(conversation.id, 1) == 0
    assert await reads.get(conversation.id, b.id) == 1
