from datetime import UTC, datetime

import pytest
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
    FakeAuditSink,
    FakeHasher,
    FakeRefreshTokenIssuer,
    FakeSessionRepository,
    FakeUnitOfWork,
    FakeUserRepository,
    FixedClock,
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


async def test_create_user_hashes_password_and_audits() -> None:
    users = FakeUserRepository()
    audit = FakeAuditSink()
    uow = FakeUnitOfWork()
    use_case = CreateUser(users, None, FakeHasher(), audit, uow, FixedClock(NOW))

    user = await use_case.execute(
        CreateUserCommand(username="ana.souza", display_name="Ana Souza", password="senha-segura")
    )

    assert user.password_hash == "argon2:senha-segura"
    assert users.users == [user]
    assert audit.records[0]["action"] == "user.create"
    assert uow.commits == 1


async def test_create_user_rejects_duplicate_username() -> None:
    users = FakeUserRepository(users=[make_user()])
    use_case = CreateUser(
        users, None, FakeHasher(), FakeAuditSink(), FakeUnitOfWork(), FixedClock(NOW)
    )

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
    use_case = Login(
        users,
        sessions,
        FakeHasher(),
        FakeAccessTokenIssuer(),
        refresh,
        FakeAuditSink(),
        FakeUnitOfWork(),
        FixedClock(NOW),
    )

    result = await use_case.execute(
        LoginCommand(username="ana.souza", password="senha-segura", device_name="pc-1")
    )

    assert result.access_token == f"access:{user.id}"
    assert result.refresh_token == "refresh:1"
    assert len(sessions.sessions) == 1
    assert sessions.sessions[0].user_id == user.id


async def test_login_rejects_wrong_password() -> None:
    users = FakeUserRepository(users=[make_user()])
    use_case = Login(
        users,
        FakeSessionRepository(),
        FakeHasher(),
        FakeAccessTokenIssuer(),
        FakeRefreshTokenIssuer(),
        FakeAuditSink(),
        FakeUnitOfWork(),
        FixedClock(NOW),
    )

    with pytest.raises(AuthenticationError):
        await use_case.execute(LoginCommand(username="ana.souza", password="errada"))


async def test_login_rejects_inactive_user() -> None:
    users = FakeUserRepository(users=[make_user(active=False)])
    use_case = Login(
        users,
        FakeSessionRepository(),
        FakeHasher(),
        FakeAccessTokenIssuer(),
        FakeRefreshTokenIssuer(),
        FakeAuditSink(),
        FakeUnitOfWork(),
        FixedClock(NOW),
    )

    with pytest.raises(InactiveUserError):
        await use_case.execute(LoginCommand(username="ana.souza", password="senha-segura"))


async def test_refresh_rotates_session() -> None:
    user = make_user()
    users = FakeUserRepository(users=[user])
    sessions = FakeSessionRepository()
    refresh = FakeRefreshTokenIssuer()
    login = Login(
        users,
        sessions,
        FakeHasher(),
        FakeAccessTokenIssuer(),
        refresh,
        FakeAuditSink(),
        FakeUnitOfWork(),
        FixedClock(NOW),
    )
    result = await login.execute(LoginCommand(username="ana.souza", password="senha-segura"))

    use_case = Refresh(
        users,
        sessions,
        FakeAccessTokenIssuer(),
        refresh,
        FakeAuditSink(),
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
        FakeAuditSink(),
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
    login = Login(
        users,
        sessions,
        FakeHasher(),
        FakeAccessTokenIssuer(),
        refresh,
        FakeAuditSink(),
        FakeUnitOfWork(),
        FixedClock(NOW),
    )
    result = await login.execute(LoginCommand(username="ana.souza", password="senha-segura"))

    use_case = Logout(sessions, refresh, FakeAuditSink(), FakeUnitOfWork(), FixedClock(NOW))
    await use_case.execute(LogoutCommand(refresh_token=result.refresh_token))

    assert sessions.sessions[0].revoked_at is not None


async def test_update_user_deactivates_and_audits() -> None:
    user = make_user()
    users = FakeUserRepository(users=[user])
    audit = FakeAuditSink()
    use_case = UpdateUser(users, audit, FakeUnitOfWork(), FixedClock(NOW))

    updated = await use_case.execute(
        UpdateUserCommand(target_id=user.id, actor_id=user.id, is_active=False)
    )

    assert updated.is_active is False
    assert audit.records[0]["action"] == "user.update"
