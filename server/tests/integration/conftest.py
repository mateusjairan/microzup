import os
import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

SERVER_ROOT = Path(__file__).resolve().parents[2]
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://microzup_owner:microzup_dev_owner@localhost:55432/microzup_test",
)


@pytest.fixture(scope="session", autouse=True)
def apply_migrations() -> None:
    env = {**os.environ, "MIGRATION_DATABASE_URL": TEST_DATABASE_URL}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=SERVER_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        pytest.fail(
            "Falha ao migrar o banco de teste. O Postgres está de pé? "
            f"URL: {TEST_DATABASE_URL}\n{result.stderr}"
        )


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as db_session:
            await db_session.execute(
                text("TRUNCATE TABLE sectors, users, sessions, audit_log RESTART IDENTITY CASCADE")
            )
            await db_session.commit()
            yield db_session
    finally:
        await engine.dispose()
