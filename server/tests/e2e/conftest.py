import asyncio
import os
import socket
import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path

# ── ANTES de qualquer import de app.main ──────────────────────────────────
# `app.main` executa `app = create_app()` no import; get_settings() lê o env
# nesse instante e o resultado é cacheado. O runtime precisa apontar para o
# banco de TESTE (papel microzup_app) antes do primeiro import.
SERVER_ROOT = Path(__file__).resolve().parents[2]
TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://microzup_owner:microzup_dev_owner@localhost:55432/microzup_test",
)
APP_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://microzup_app:microzup_dev_app@localhost:55432/microzup_test",
)
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = APP_DB_URL
os.environ.setdefault("RATE_LIMIT_LOGIN_PER_MINUTE", "1000")

import httpx  # noqa: E402
import pytest  # noqa: E402
import uvicorn  # noqa: E402
from app.core.compat import configure_event_loop  # noqa: E402
from app.main import create_app  # noqa: E402
from sqlalchemy import text  # noqa: E402

SERVER_PASSWORD = "senha-forte"


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


async def _reset_and_seed() -> None:
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
        await CreateUser(
            users=SqlAlchemyUserRepository(session),
            sectors=None,
            hasher=Argon2Hasher(),
            uow=SqlAlchemyUnitOfWork(session),
            clock=SystemClock(),
        ).execute(
            CreateUserCommand(
                username="admin",
                display_name="Administrador",
                password="admin12345",
                role="admin",
            )
        )
    await engine.dispose()


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


@pytest.fixture
async def server() -> AsyncIterator[str]:
    """Servidor uvicorn REAL em porta livre; devolve a base URL HTTP.

    Postgres de teste real, lifespan completo (hub, subscriber de auditoria,
    tickets de uso único) — nada de TestClient: socket de verdade na rede.
    """
    configure_event_loop()
    await _reset_and_seed()

    app = create_app()
    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    uvicorn_server = uvicorn.Server(config)
    serve_task = asyncio.create_task(uvicorn_server.serve())

    for _ in range(200):
        if uvicorn_server.started:
            break
        await asyncio.sleep(0.05)
    else:
        serve_task.cancel()
        pytest.fail("servidor uvicorn não subiu")

    yield f"http://127.0.0.1:{port}"

    uvicorn_server.should_exit = True
    try:
        await asyncio.wait_for(serve_task, timeout=10)
    except TimeoutError:
        serve_task.cancel()


async def _login(http: httpx.AsyncClient, username: str, password: str = SERVER_PASSWORD) -> str:
    response = await http.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.fixture
async def seeded(server: str) -> dict:
    """Admin + setor + dois usuários + DM aberta; devolve tokens e ids."""
    async with httpx.AsyncClient(base_url=server, timeout=10.0) as http:
        admin = await _login(http, "admin", "admin12345")
        admin_h = {"Authorization": f"Bearer {admin}"}
        sector = await http.post("/admin/sectors", headers=admin_h, json={"name": "E2E"})
        assert sector.status_code == 201, sector.text
        ids: dict[str, str] = {}
        for username in ("ana.souza", "bruno.lima"):
            created = await http.post(
                "/admin/users",
                headers=admin_h,
                json={
                    "username": username,
                    "display_name": username.replace(".", " ").title(),
                    "password": SERVER_PASSWORD,
                    "sector_id": sector.json()["id"],
                },
            )
            assert created.status_code == 201, created.text
            ids[username] = created.json()["id"]

        ana = await _login(http, "ana.souza")
        bruno = await _login(http, "bruno.lima")
        dm = await http.post(
            "/conversations/dm",
            headers={"Authorization": f"Bearer {ana}"},
            json={"user_id": ids["bruno.lima"]},
        )
        assert dm.status_code == 200, dm.text
        return {
            "base_url": server,
            "ids": ids,
            "ana": ana,
            "bruno": bruno,
            "dm_id": dm.json()["id"],
        }
