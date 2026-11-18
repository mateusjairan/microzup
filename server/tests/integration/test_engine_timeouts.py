"""Engine: statement_timeout e idle_in_transaction_session_timeout por conexão (plano §8)."""

import os

import pytest
from app.infrastructure.db.session import create_engine, create_session_factory
from sqlalchemy import text

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://microzup_owner:microzup_dev_owner@localhost:55432/microzup_test",
)


@pytest.mark.integration
async def test_engine_applies_statement_timeouts() -> None:
    engine = create_engine(
        TEST_DB_URL,
        statement_timeout_ms=1234,
        idle_in_transaction_session_timeout_ms=5678,
    )
    try:
        factory = create_session_factory(engine)
        async with factory() as session:
            statement_timeout = (
                await session.execute(text("SELECT current_setting('statement_timeout')"))
            ).scalar_one()
            idle_timeout = (
                await session.execute(
                    text("SELECT current_setting('idle_in_transaction_session_timeout')")
                )
            ).scalar_one()

        assert statement_timeout == "1234ms"
        assert idle_timeout == "5678ms"
    finally:
        await engine.dispose()


@pytest.mark.integration
async def test_engine_without_timeouts_leaves_defaults() -> None:
    engine = create_engine(TEST_DB_URL)
    try:
        factory = create_session_factory(engine)
        async with factory() as session:
            statement_timeout = (
                await session.execute(text("SELECT current_setting('statement_timeout')"))
            ).scalar_one()
        assert statement_timeout == "0"
    finally:
        await engine.dispose()
