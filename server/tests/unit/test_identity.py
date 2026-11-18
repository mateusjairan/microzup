from datetime import UTC, datetime

import pytest
from app.application.audit import apply_audit
from app.application.use_cases.create_user import CreateUser, CreateUserCommand
from app.application.use_cases.login import Login, LoginCommand
from app.application.use_cases.logout import Logout, LogoutCommand
from app.application.use_cases.refresh import Refresh, RefreshCommand
from app.application.use_cases.update_user import UpdateUser, UpdateUserCommand
from app.domain.entities.user import User, Username
from app.domain.exceptions import (
    AuthenticationError,
    InactiveUserError,
    InvalidTokenError,
    UserAlreadyExists,
)

from tests.unit.fakes import (
    FakeAccessTokenIssuer,
    FakeEventBus,
    FakeHasher,
    FakeRefreshTokenIssuer,
    FakeSessionRepository,
    FakeUnitOfWork,
    FakeUserRepository,
    FixedClock,
    audit_events,
)

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)


def make_user(username: str = "ana.souza", role: str = "member", active: bool = True) -> User:
    user = User.create(
        username=Username(username),
        display_name="Ana Souza",
        role=role,  # type: ignore[arg-type]
        sector_id=None,
        password_hash=FakeHasher().hash("senha-segura"),
        now=NOW,
    )
    if not active:
        user = user.with_active(False, NOW)
    return user


def make_login(users, sessions, refresh, events) -> Login:
    return Login(
        users,
        sessions,
        FakeHasher(),
        FakeAccessTokenIssuer(),
        refresh,
        events,
        FakeUnitOfWork(),
        FixedClock(NOW),
    )


async def test_create_user_hashes_password_and_audits() -> None:
    users = FakeUserRepository()
    bus = FakeEventBus()
    uow = FakeUnitOfWork()
    use_case = CreateUser(users, None, FakeHasher(), uow, FixedClock(NOW))
    # Auditoria por composição: mesmo decorator aplicado em deps.py / CLI.
    apply_audit(
        use_case,
        bus,
        action=lambda cmd: cmd.audit_action,
        entity_type="user",
        entity_id=lambda cmd, result: str(result.id),
        actor=lambda cmd: cmd.actor_id,
        metadata=lambda cmd, result: {"username": result.username, "role": result.role},
        ip=lambda cmd: cmd.ip,
    )

    user = await use_case.execute(
        CreateUserCommand(username="ana.souza", display_name="Ana Souza", password="senha-segura")
    )

    assert user.password_hash == "argon2:senha-segura"
    assert users.users == [user]
    records = audit_events(bus)
    assert records[0].action == "user.create"
    assert records[0].metadata == {"username": "ana.souza", "role": "member"}
    assert uow.commits == 1


async def test_create_user_rejects_duplicate_username() -> None:
    users = FakeUserRepository(users=[make_user()])
    use_case = CreateUser(users, None, FakeHasher(), FakeUnitOfWork(), FixedClock(NOW))

    with pytest.raises(UserAlreadyExists):
        await use_case.execute(
            CreateUserCommand(username="ana.souza", display_name="Outra", password="senha-segura")
        )

    assert len(users.users) == 1


async def test_login_issues_tokens_and_session() -> None:
    user = make_user()
    users = FakeUserRepository(users=[user])
    sessions = FakeSessionRepository()
    refresh = FakeRefreshTokenIssuer()
    use_case = make_login(users, sessions, refresh, FakeEventBus())

    result = await use_case.execute(
        LoginCommand(username="ana.souza", password="senha-segura", device_name="pc-1")
    )

    assert result.access_token == f"access:{user.id}"
    assert result.refresh_token == "refresh:1"
    assert len(sessions.sessions) == 1
    assert sessions.sessions[0].user_id == user.id


async def test_login_audits_via_event_bus() -> None:
    users = FakeUserRepository(users=[make_user()])
    sessions = FakeSessionRepository()
    bus = FakeEventBus()
    use_case = make_login(users, sessions, FakeRefreshTokenIssuer(), bus)

    await use_case.execute(
        LoginCommand(
            username="ana.souza", password="senha-segura", device_name="pc-1", ip="10.0.0.5"
        )
    )

    records = audit_events(bus)
    assert records[0].action == "auth.login"
    assert records[0].actor_id == users.users[0].id
    assert records[0].ip == "10.0.0.5"
    assert records[0].metadata == {"device_name": "pc-1"}


async def test_login_rejects_wrong_password() -> None:
    users = FakeUserRepository(users=[make_user()])
    use_case = make_login(users, FakeSessionRepository(), FakeRefreshTokenIssuer(), FakeEventBus())

    with pytest.raises(AuthenticationError):
        await use_case.execute(LoginCommand(username="ana.souza", password="errada"))


async def test_login_rejects_inactive_user() -> None:
    users = FakeUserRepository(users=[make_user(active=False)])
    use_case = make_login(users, FakeSessionRepository(), FakeRefreshTokenIssuer(), FakeEventBus())

    with pytest.raises(InactiveUserError):
        await use_case.execute(LoginCommand(username="ana.souza", password="senha-segura"))


async def test_refresh_rotates_session() -> None:
    user = make_user()
    users = FakeUserRepository(users=[user])
    sessions = FakeSessionRepository()
    refresh = FakeRefreshTokenIssuer()
    login = make_login(users, sessions, refresh, FakeEventBus())
    result = await login.execute(LoginCommand(username="ana.souza", password="senha-segura"))

    use_case = Refresh(
        users,
        sessions,
        FakeAccessTokenIssuer(),
        refresh,
        FakeEventBus(),
        FakeUnitOfWork(),
        FixedClock(NOW),
    )
    refreshed = await use_case.execute(RefreshCommand(refresh_token=result.refresh_token))

    assert refreshed.refresh_token == "refresh:2"
    assert sessions.sessions[0].revoked_at is not None
    assert len(sessions.sessions) == 2


async def test_refresh_rejects_unknown_token() -> None:
    use_case = Refresh(
        FakeUserRepository(),
        FakeSessionRepository(),
        FakeAccessTokenIssuer(),
        FakeRefreshTokenIssuer(),
        FakeEventBus(),
        FakeUnitOfWork(),
        FixedClock(NOW),
    )

    with pytest.raises(InvalidTokenError):
        await use_case.execute(RefreshCommand(refresh_token="desconhecido"))


async def test_logout_revokes_session() -> None:
    user = make_user()
    users = FakeUserRepository(users=[user])
    sessions = FakeSessionRepository()
    refresh = FakeRefreshTokenIssuer()
    login = make_login(users, sessions, refresh, FakeEventBus())
    result = await login.execute(LoginCommand(username="ana.souza", password="senha-segura"))

    bus = FakeEventBus()
    use_case = Logout(sessions, refresh, bus, FakeUnitOfWork(), FixedClock(NOW))
    await use_case.execute(LogoutCommand(refresh_token=result.refresh_token, ip="10.0.0.7"))

    assert sessions.sessions[0].revoked_at is not None
    records = audit_events(bus)
    assert records[0].action == "auth.logout"
    assert records[0].actor_id == user.id
    assert records[0].ip == "10.0.0.7"


async def test_update_user_deactivates_and_audits() -> None:
    user = make_user()
    users = FakeUserRepository(users=[user])
    bus = FakeEventBus()
    use_case = UpdateUser(
        users,
        FakeUnitOfWork(),
        FixedClock(NOW),
        events=bus,
    )

    updated = await use_case.execute(
        UpdateUserCommand(target_id=user.id, actor_id=user.id, is_active=False)
    )

    assert updated.is_active is False
    records = audit_events(bus)
    assert records[0].action == "user.update"
    assert records[0].metadata == {"is_active": False}
    # A desativação também publica o evento de domínio (hub fecha o WS).
    from app.application.events import UserDeactivated

    assert any(isinstance(e, UserDeactivated) for e in bus.events)
