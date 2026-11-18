import asyncio
import os
import shutil
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
# dir explícito dentro do repo: alguns runners resolvem o tempdir para o cwd.
_STORAGE_TMP = Path(tempfile.mkdtemp(prefix="microzup-test-", dir=str(SERVER_ROOT)))
os.environ["STORAGE_DIR"] = str(_STORAGE_TMP)
# Testes de API fazem logins repetidos do admin por helper (mesmo IP no TestClient);
# o limite de login é exercitado em teste dedicado + unitário, então sobe o teto aqui.
os.environ.setdefault("RATE_LIMIT_LOGIN_PER_MINUTE", "1000")


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


@pytest.fixture(scope="session", autouse=True)
def _remove_storage_tmp():
    yield
    shutil.rmtree(_STORAGE_TMP, ignore_errors=True)


def _reset_and_seed() -> None:
    from app.core.compat import configure_event_loop

    configure_event_loop()
    asyncio.run(_reset_and_seed_async())


async def _reset_and_seed_async() -> None:
    from app.application.dto import CreateUserCommand
    from app.application.use_cases.create_user import CreateUser
    from app.infrastructure.clock import SystemClock
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
        # O admin de seed não audita: a auditoria agora é efeito colateral via
        # EventBus (decorator @audit), aplicada apenas nas bordas reais de API/CLI.
        use_case = CreateUser(
            users=SqlAlchemyUserRepository(session),
            sectors=None,
            hasher=Argon2Hasher(),
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
