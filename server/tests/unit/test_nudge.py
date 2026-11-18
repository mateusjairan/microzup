from datetime import UTC, datetime
from uuid import uuid4

import pytest
from app.application.use_cases.nudge import NUDGE_WINDOW_SECONDS, NudgeCommand, SendNudge
from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.entities.user import User, Username
from app.domain.exceptions import AccessDeniedError

from tests.unit.fakes import (
    FakeConversationRepository,
    FakeEventBus,
    FakeHasher,
    FakePresenceDirectory,
    FakeRateLimiter,
    FakeUserRepository,
    audit_events,
)

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)


def make_user(username: str) -> User:
    return User.create(
        Username(username), username, "member", None, FakeHasher().hash("x" * 10), NOW
    )


def build_dm(a: User, b: User):
    conversation = Conversation.create_dm(a.id, b.id, NOW)
    conversations = FakeConversationRepository(
        conversations=[conversation],
        members=[
            ConversationMember.create(conversation.id, a.id, NOW),
            ConversationMember.create(conversation.id, b.id, NOW),
        ],
    )
    return conversation, conversations


def build_use_case(a: User, b: User, statuses: dict):
    conversation, conversations = build_dm(a, b)
    events = FakeEventBus()
    throttle = FakeRateLimiter()
    presence = FakePresenceDirectory(statuses=statuses)
    use_case = SendNudge(
        conversations=conversations,
        users=FakeUserRepository(users=[a, b]),
        presence=presence,
        throttle=throttle,
        events=events,
    )
    return conversation, use_case, events, throttle, presence


async def test_nudge_delivered_to_online_members_and_audited() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, use_case, events, _, _ = build_use_case(
        a, b, {b.id: "available", a.id: "available"}
    )

    result = await use_case.execute(NudgeCommand(conversation_id=conversation.id, sender_id=a.id))

    assert result.delivered is True
    assert result.recipient_ids == frozenset({b.id})

    from app.application.events import NudgeSent

    sent = [e for e in events.events if isinstance(e, NudgeSent)]
    assert len(sent) == 1
    assert sent[0].sender_name == "ana.souza"
    assert sent[0].recipient_ids == frozenset({b.id})

    records = audit_events(events)
    assert records[0].action == "message.nudge"
    assert records[0].entity_id == str(conversation.id)


async def test_nudge_throttled_one_per_conversation_per_sender() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, use_case, events, throttle, _ = build_use_case(a, b, {b.id: "available"})

    first = await use_case.execute(NudgeCommand(conversation_id=conversation.id, sender_id=a.id))
    second = await use_case.execute(NudgeCommand(conversation_id=conversation.id, sender_id=a.id))

    assert first.delivered is True
    assert second.delivered is False
    assert second.reason == "throttled"
    # Nada novo auditar/publicar quando throttled.
    assert len(audit_events(events)) == 1
    assert len(events.events) == 2  # AuditRequested + NudgeSent, uma vez só

    throttle.advance(NUDGE_WINDOW_SECONDS + 1)
    third = await use_case.execute(NudgeCommand(conversation_id=conversation.id, sender_id=a.id))
    assert third.delivered is True


async def test_nudge_refused_when_peer_in_dnd() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, use_case, events, _, _ = build_use_case(a, b, {b.id: "dnd"})

    result = await use_case.execute(NudgeCommand(conversation_id=conversation.id, sender_id=a.id))

    assert result.delivered is False
    assert result.reason == "dnd"
    assert events.events == []


async def test_nudge_refusal_does_not_burn_cooldown() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, use_case, events, _, presence = build_use_case(a, b, {b.id: "dnd"})

    refused = await use_case.execute(NudgeCommand(conversation_id=conversation.id, sender_id=a.id))
    assert refused.reason == "dnd"

    # O par sai do DND: o nudge imediatamente seguinte deve passar (sem cooldown).
    presence.statuses[b.id] = "available"
    delivered = await use_case.execute(
        NudgeCommand(conversation_id=conversation.id, sender_id=a.id)
    )
    assert delivered.delivered is True
    assert len(audit_events(events)) == 1


async def test_nudge_refused_when_everyone_offline() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, use_case, events, _, _ = build_use_case(a, b, {})

    result = await use_case.execute(NudgeCommand(conversation_id=conversation.id, sender_id=a.id))

    assert result.delivered is False
    assert result.reason == "unavailable"


async def test_nudge_invisible_peer_appears_offline_and_is_refused() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation, use_case, _, _, _ = build_use_case(a, b, {b.id: "invisible"})

    result = await use_case.execute(NudgeCommand(conversation_id=conversation.id, sender_id=a.id))

    assert result.delivered is False
    assert result.reason == "unavailable"


async def test_nudge_by_non_member_is_denied() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    outsider = make_user("carla.dias")
    conversation, conversations = build_dm(a, b)
    use_case = SendNudge(
        conversations=conversations,
        users=FakeUserRepository(users=[a, b, outsider]),
        presence=FakePresenceDirectory(statuses={a.id: "available", b.id: "available"}),
        throttle=FakeRateLimiter(),
        events=FakeEventBus(),
    )

    with pytest.raises(AccessDeniedError):
        await use_case.execute(NudgeCommand(conversation_id=conversation.id, sender_id=outsider.id))


async def test_nudge_skips_dnd_member_but_delivers_to_available_one() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")  # dnd
    c = make_user("carla.dias")  # available
    conversation = Conversation.create_dm(a.id, b.id, NOW)
    conversations = FakeConversationRepository(
        conversations=[conversation],
        members=[
            ConversationMember.create(conversation.id, a.id, NOW),
            ConversationMember.create(conversation.id, b.id, NOW),
            ConversationMember.create(conversation.id, c.id, NOW),
        ],
    )
    use_case = SendNudge(
        conversations=conversations,
        users=FakeUserRepository(users=[a, b, c]),
        presence=FakePresenceDirectory(statuses={b.id: "dnd", c.id: "available"}),
        throttle=FakeRateLimiter(),
        events=FakeEventBus(),
    )

    result = await use_case.execute(NudgeCommand(conversation_id=conversation.id, sender_id=a.id))

    assert result.delivered is True
    assert result.recipient_ids == frozenset({c.id})


async def test_nudge_unknown_conversation_is_not_found() -> None:
    from app.domain.exceptions import NotFoundError

    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    _, use_case, _, _, _ = build_use_case(a, b, {b.id: "available"})

    with pytest.raises(NotFoundError):
        await use_case.execute(NudgeCommand(conversation_id=uuid4(), sender_id=a.id))
