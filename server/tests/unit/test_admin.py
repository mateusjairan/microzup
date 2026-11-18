from datetime import UTC, datetime

import pytest
from app.application.use_cases.reset_password import ResetPassword, ResetPasswordCommand
from app.application.use_cases.update_sector import UpdateSector, UpdateSectorCommand
from app.domain.entities.conversation import Conversation
from app.domain.entities.sector import Sector
from app.domain.entities.session import UserSession
from app.domain.entities.user import User, Username
from app.domain.exceptions import SectorAlreadyExists, ValidationError

from tests.unit.fakes import (
    FakeAuditSink,
    FakeConversationRepository,
    FakeHasher,
    FakeSectorRepository,
    FakeSessionRepository,
    FakeUnitOfWork,
    FakeUserRepository,
    FixedClock,
)

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)


def make_user(username: str = "ana.souza") -> User:
    return User.create(
        username=Username(username),
        display_name="Ana Souza",
        role="member",
        sector_id=None,
        password_hash=FakeHasher().hash("senha-antiga"),
        now=NOW,
    )


async def test_update_sector_renames_channel_and_audits() -> None:
    sectors = FakeSectorRepository()
    conversations = FakeConversationRepository()
    audit = FakeAuditSink()
    uow = FakeUnitOfWork()

    sector = Sector.create("Qualidade", "QA", NOW)
    channel = Conversation.create_channel(sector.id, sector.name, None, NOW)
    sectors.sectors.append(sector)
    conversations.conversations.append(channel)

    use_case = UpdateSector(sectors, conversations, audit, uow, FixedClock(NOW))
    updated = await use_case.execute(
        UpdateSectorCommand(
            target_id=sector.id, name="Qualidade e Assuntos Regulatórios", description="QA"
        )
    )

    assert updated.name == "Qualidade e Assuntos Regulatórios"
    assert updated.slug == "qualidade-e-assuntos-regulatorios"
    assert conversations.conversations[0].name == updated.name
    assert audit.records[0]["action"] == "sector.update"
    assert uow.commits == 1


async def test_update_sector_rejects_duplicate_slug() -> None:
    sectors = FakeSectorRepository()
    conversations = FakeConversationRepository()
    first = Sector.create("Qualidade", None, NOW)
    second = Sector.create("Produção", None, NOW)
    sectors.sectors.extend([first, second])

    use_case = UpdateSector(
        sectors, conversations, FakeAuditSink(), FakeUnitOfWork(), FixedClock(NOW)
    )

    with pytest.raises(SectorAlreadyExists):
        await use_case.execute(
            UpdateSectorCommand(target_id=second.id, name="Qualidade", description=None)
        )


async def test_reset_password_changes_hash_revokes_sessions_and_audits() -> None:
    users = FakeUserRepository()
    sessions = FakeSessionRepository()
    audit = FakeAuditSink()
    uow = FakeUnitOfWork()

    user = make_user()
    session = UserSession.create(user.id, "hash", None, None, None, NOW)
    users.users.append(user)
    sessions.sessions.append(session)

    use_case = ResetPassword(users, sessions, FakeHasher(), audit, uow, FixedClock(NOW))
    updated = await use_case.execute(
        ResetPasswordCommand(target_id=user.id, new_password="senha-nova", actor_id=user.id)
    )

    assert updated.password_hash == "argon2:senha-nova"
    assert sessions.sessions[0].revoked_at == NOW
    assert audit.records[0]["action"] == "user.password_reset"
    assert audit.records[0]["metadata"] == {"sessions_revoked": 1}
    assert uow.commits == 1


async def test_reset_password_rejects_short_password() -> None:
    users = FakeUserRepository()
    user = make_user()
    users.users.append(user)

    use_case = ResetPassword(
        users,
        FakeSessionRepository(),
        FakeHasher(),
        FakeAuditSink(),
        FakeUnitOfWork(),
        FixedClock(NOW),
    )

    with pytest.raises(ValidationError):
        await use_case.execute(
            ResetPasswordCommand(target_id=user.id, new_password="123", actor_id=user.id)
        )
