import pytest
from app.domain.entities.session import UserSession
from app.domain.entities.user import User, Username
from app.infrastructure.clock import SystemClock
from app.infrastructure.db.repositories.sessions import SqlAlchemySessionRepository
from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
from app.infrastructure.db.uow import SqlAlchemyUnitOfWork

pytestmark = pytest.mark.integration


async def test_user_round_trip_is_case_insensitive(session) -> None:
    users = SqlAlchemyUserRepository(session)
    clock = SystemClock()
    user = User.create(Username("Bruno.Lima"), "Bruno Lima", "member", None, "hash", clock.now())

    async with SqlAlchemyUnitOfWork(session):
        await users.add(user)

    fetched = await users.get_by_username("bruno.lima")
    assert fetched == user

    listing = await users.list_active()
    assert [u.id for u in listing] == [user.id]


async def test_session_round_trip_and_revoke(session) -> None:
    from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository

    clock = SystemClock()
    users = SqlAlchemyUserRepository(session)
    user = User.create(Username("carla.dias"), "Carla Dias", "member", None, "hash", clock.now())
    async with SqlAlchemyUnitOfWork(session):
        await users.add(user)

    sessions = SqlAlchemySessionRepository(session)
    created = UserSession.create(
        user_id=user.id,
        refresh_token_hash="a" * 64,
        device_name="pc-1",
        ip="10.0.0.2",
        user_agent="pytest",
        now=clock.now(),
    )

    async with SqlAlchemyUnitOfWork(session):
        await sessions.add(created)

    fetched = await sessions.get_by_refresh_hash("a" * 64)
    assert fetched == created

    async with SqlAlchemyUnitOfWork(session):
        await sessions.update(fetched.revoke(clock.now()))

    revoked = await sessions.get_by_refresh_hash("a" * 64)
    assert revoked is not None
    assert revoked.revoked_at is not None
