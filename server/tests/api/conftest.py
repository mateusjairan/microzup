import asyncio
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
from sqlalchemy import text

SERVER_ROOT = Path(__file__).resolve().parents[2]
TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://microzup_owner:microzup_dev_owner@localhost:55432/microzup_test",
)
APP_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://microzup_app:microzup_dev_app@localhost:55432/microzup_test",
)

# Antes de qualquer import de app.main, apontamos o runtime para o banco de teste.
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = APP_DB_URL
os.environ["STORAGE_DIR"] = tempfile.mkdtemp(prefix="microzup-test-")


@pytest.fixture(scope="session", autouse=True)
def _migrate() -> None:
    env = {**os.environ, "MIGRATION_DATABASE_URL": TEST_DB_URL}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=SERVER_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        pytest.fail(f"Falha ao migrar o banco de teste:\n{result.stderr}")


def _reset_and_seed() -> None:
    from app.core.compat import configure_event_loop

    configure_event_loop()
    asyncio.run(_reset_and_seed_async())


async def _reset_and_seed_async() -> None:
    from app.application.use_cases.create_user import CreateUser, CreateUserCommand
    from app.infrastructure.clock import SystemClock
    from app.infrastructure.db.repositories.audit import SqlAlchemyAuditSink
    from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
    from app.infrastructure.db.session import create_engine, create_session_factory
    from app.infrastructure.db.uow import SqlAlchemyUnitOfWork
    from app.infrastructure.security import Argon2Hasher

    # O seed limpa e cria o admin usando o papel owner (runtime não tem TRUNCATE).
    engine = create_engine(TEST_DB_URL)
    factory = create_session_factory(engine)
    async with factory() as session:
        await session.execute(
            text("TRUNCATE sectors, users, sessions, audit_log RESTART IDENTITY CASCADE")
        )
        await session.commit()
        use_case = CreateUser(
            users=SqlAlchemyUserRepository(session),
            sectors=None,
            hasher=Argon2Hasher(),
            audit=SqlAlchemyAuditSink(session),
            uow=SqlAlchemyUnitOfWork(session),
            clock=SystemClock(),
        )
        await use_case.execute(
            CreateUserCommand(
                username="admin", display_name="Administrador", password="admin12345", role="admin"
            )
        )
    await engine.dispose()


@pytest.fixture
def client():
    from app.main import create_app
    from fastapi.testclient import TestClient

    _reset_and_seed()
    with TestClient(create_app()) as test_client:
        yield test_client
