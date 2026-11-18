from datetime import UTC, datetime
from uuid import uuid4

import pytest
from app.application.events import UserDeactivated
from app.application.use_cases.create_user import CreateUser, CreateUserCommand
from app.application.use_cases.update_user import UpdateUser, UpdateUserCommand
from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.entities.sector import Sector
from app.domain.entities.session import UserSession
from app.domain.entities.user import User, Username
from app.domain.exceptions import NotFoundError

from tests.unit.fakes import (
    FakeConversationRepository,
    FakeEventBus,
    FakeHasher,
    FakeSectorRepository,
    FakeSessionRepository,
    FakeUnitOfWork,
    FakeUserRepository,
    FixedClock,
    audit_events,
)

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)


def make_user(username: str, sector_id=None) -> User:
    return User.create(
        Username(username),
        username,
        "member",
        sector_id,
        FakeHasher().hash("x" * 10),
        NOW,
    )


def make_sector(name: str) -> Sector:
    return Sector.create(name, None, NOW)


def build_channel(sector: Sector) -> Conversation:
    return Conversation.create_channel(sector.id, sector.name, None, NOW)


def build_stack():
    users = FakeUserRepository()
    sectors = FakeSectorRepository()
    conversations = FakeConversationRepository()
    sessions = FakeSessionRepository()
    events = FakeEventBus()
    uow = FakeUnitOfWork()
    update_use_case = UpdateUser(
        users, uow, FixedClock(NOW), events, sectors, conversations, sessions
    )
    create_use_case = CreateUser(
        users,
        sectors,
        FakeHasher(),
        uow,
        FixedClock(NOW),
        conversations,
    )
    return {
        "users": users,
        "sectors": sectors,
        "conversations": conversations,
        "sessions": sessions,
        "events": events,
        "uow": uow,
        "update": update_use_case,
        "create": create_use_case,
    }


async def test_create_user_with_sector_jins_sector_channel() -> None:
    stack = build_stack()
    sector = make_sector("Qualidade")
    stack["sectors"].sectors.append(sector)
    channel = build_channel(sector)
    stack["conversations"].conversations.append(channel)

    user = await stack["create"].execute(
        CreateUserCommand(
            username="ana.souza",
            display_name="Ana Souza",
            password="senha-forte",
            sector_id=sector.id,
        )
    )

    member = await stack["conversations"].get_member(channel.id, user.id)
    assert member is not None
    assert member.left_at is None


async def test_update_user_sector_move_rematerializes_membership() -> None:
    stack = build_stack()
    old_sector = make_sector("Qualidade")
    new_sector = make_sector("Produção")
    stack["sectors"].sectors.extend([old_sector, new_sector])
    old_channel = build_channel(old_sector)
    new_channel = build_channel(new_sector)
    stack["conversations"].conversations.extend([old_channel, new_channel])

    user = make_user("ana.souza", old_sector.id)
    stack["users"].users.append(user)
    stack["conversations"].members.append(ConversationMember.create(old_channel.id, user.id, NOW))

    updated = await stack["update"].execute(
        UpdateUserCommand(
            target_id=user.id,
            actor_id=uuid_admin_id(),
            sector_id=new_sector.id,
        )
    )

    assert updated.sector_id == new_sector.id

    old_member = await stack["conversations"].get_member(old_channel.id, user.id)
    new_member = await stack["conversations"].get_member(new_channel.id, user.id)

    # Saiu do canal do setor antigo (left_at materializado) e entrou no novo.
    assert old_member is not None
    assert old_member.left_at is not None
    assert new_member is not None
    assert new_member.left_at is None

    # list_for_user só devolve o canal novo.
    visible = await stack["conversations"].list_for_user(user.id)
    assert [c.id for c in visible] == [new_channel.id]


def uuid_admin_id():
    return uuid4()


async def test_update_user_moving_back_rejoins_channel() -> None:
    stack = build_stack()
    old_sector = make_sector("Qualidade")
    new_sector = make_sector("Produção")
    stack["sectors"].sectors.extend([old_sector, new_sector])
    old_channel = build_channel(old_sector)
    new_channel = build_channel(new_sector)
    stack["conversations"].conversations.extend([old_channel, new_channel])

    user = make_user("ana.souza", old_sector.id)
    stack["users"].users.append(user)
    stack["conversations"].members.append(ConversationMember.create(old_channel.id, user.id, NOW))

    await stack["update"].execute(
        UpdateUserCommand(target_id=user.id, actor_id=uuid_admin_id(), sector_id=new_sector.id)
    )
    # Volta para o setor antigo: rejoin limpa o left_at em vez de duplicar a linha.
    await stack["update"].execute(
        UpdateUserCommand(target_id=user.id, actor_id=uuid_admin_id(), sector_id=old_sector.id)
    )

    members_of_old = [
        m
        for m in stack["conversations"].members
        if m.conversation_id == old_channel.id and m.user_id == user.id
    ]
    assert len(members_of_old) == 1
    assert members_of_old[0].left_at is None


async def test_update_user_move_to_sector_without_channel_creates_it() -> None:
    stack = build_stack()
    old_sector = make_sector("Qualidade")
    new_sector = make_sector("Regulatório")  # sem canal ainda
    stack["sectors"].sectors.extend([old_sector, new_sector])
    old_channel = build_channel(old_sector)
    stack["conversations"].conversations.append(old_channel)

    user = make_user("ana.souza", old_sector.id)
    stack["users"].users.append(user)
    stack["conversations"].members.append(ConversationMember.create(old_channel.id, user.id, NOW))

    await stack["update"].execute(
        UpdateUserCommand(target_id=user.id, actor_id=uuid_admin_id(), sector_id=new_sector.id)
    )

    new_channel = await stack["conversations"].get_channel_by_sector(new_sector.id)
    assert new_channel is not None
    member = await stack["conversations"].get_member(new_channel.id, user.id)
    assert member is not None
    assert member.left_at is None


async def test_update_user_move_to_unknown_sector_fails() -> None:
    stack = build_stack()
    sector = make_sector("Qualidade")
    stack["sectors"].sectors.append(sector)
    user = make_user("ana.souza", sector.id)
    stack["users"].users.append(user)

    with pytest.raises(NotFoundError):
        await stack["update"].execute(
            UpdateUserCommand(target_id=user.id, actor_id=uuid_admin_id(), sector_id=uuid4())
        )


async def test_update_user_deactivation_revokes_sessions_and_publishes() -> None:
    stack = build_stack()
    user = make_user("ana.souza")
    stack["users"].users.append(user)
    session = UserSession.create(user.id, "hash", None, None, None, NOW)
    stack["sessions"].sessions.append(session)

    updated = await stack["update"].execute(
        UpdateUserCommand(target_id=user.id, actor_id=uuid_admin_id(), is_active=False)
    )

    assert updated.is_active is False
    # Sessões revogadas imediatamente (refresh também cai).
    assert stack["sessions"].sessions[0].revoked_at == NOW
    # Evento para o hub fechar os sockets WS abertos.
    deactivated = [e for e in stack["events"].events if isinstance(e, UserDeactivated)]
    assert len(deactivated) == 1
    assert deactivated[0].user_id == user.id
    # Auditoria via EventBus: user.update com as mudanças no metadata.
    records = audit_events(stack["events"])
    assert records[0].action == "user.update"
    assert records[0].metadata == {"is_active": False}


async def test_update_user_reactivation_does_not_publish() -> None:
    stack = build_stack()
    user = make_user("ana.souza").with_active(False, NOW)
    stack["users"].users.append(user)

    await stack["update"].execute(
        UpdateUserCommand(target_id=user.id, actor_id=uuid_admin_id(), is_active=True)
    )

    assert [e for e in stack["events"].events if isinstance(e, UserDeactivated)] == []
