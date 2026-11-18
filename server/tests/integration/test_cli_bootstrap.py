"""Bootstrap do primeiro admin via CLI (plano §8): --sector, user.bootstrap, idempotência."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import text

SERVER_ROOT = Path(__file__).resolve().parents[2]
APP_TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://microzup_app:microzup_dev_app@localhost:55432/microzup_test",
)


def _run_cli(username: str, args: list[str], stdin: str = "") -> subprocess.CompletedProcess:
    env = {
        **os.environ,
        "APP_ENV": "test",
        "DATABASE_URL": APP_TEST_DB_URL,
    }
    return subprocess.run(
        [sys.executable, "-m", "app.cli", "create-admin", "--username", username, *args],
        cwd=SERVER_ROOT,
        env=env,
        input=stdin,
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )


async def _insert_sector(session, slug: str, name: str) -> str:
    result = await session.execute(
        text("INSERT INTO sectors (name, slug) VALUES (:name, :slug) RETURNING id::text"),
        {"name": name, "slug": slug},
    )
    value = str(result.scalar_one())
    await session.commit()
    return value


async def test_create_admin_with_sector_materializes_channel_and_bootstraps_audit(session) -> None:
    sector_id = await _insert_sector(session, "ti", "Tecnologia")

    result = _run_cli(
        "admin.piloto",
        ["--sector", "ti"],
        stdin="senha-forte-1\nsenha-forte-1\n",
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Administrador criado" in result.stdout

    user_result = await session.execute(
        text("SELECT id::text, role, sector_id::text FROM users WHERE username = 'admin.piloto'")
    )
    user_row = user_result.one()
    assert user_row.role == "admin"
    assert user_row.sector_id == sector_id

    # Auditoria de bootstrap: actor NULL + action user.bootstrap (não user.create).
    audit_result = await session.execute(
        text(
            "SELECT actor_id, action, metadata FROM audit_log "
            "WHERE entity_type = 'user' ORDER BY id DESC LIMIT 1"
        )
    )
    audit_row = audit_result.one()
    assert audit_row.action == "user.bootstrap"
    assert audit_row.actor_id is None

    # Membro materializado no canal do setor.
    member_result = await session.execute(
        text(
            "SELECT COUNT(*) FROM conversation_members cm "
            "JOIN conversations c ON c.id = cm.conversation_id "
            "WHERE c.kind = 'channel' AND c.sector_id = :sector_id "
            "AND cm.user_id = :user_id AND cm.left_at IS NULL"
        ),
        {"sector_id": sector_id, "user_id": user_row.id},
    )
    assert int(member_result.scalar_one()) == 1


async def test_create_admin_is_idempotent_without_overwriting_password(session) -> None:
    await _insert_sector(session, "rh", "Recursos Humanos")
    first = _run_cli("admin.fix", ["--sector", "rh"], stdin="senha-original-1\nsenha-original-1\n")
    assert first.returncode == 0, first.stdout + first.stderr

    hash_result = await session.execute(
        text("SELECT password_hash FROM users WHERE username = 'admin.fix'")
    )
    hash_before = hash_result.scalar_one()

    # Segunda execução: recusa sem pedir senha e sem sobrescrever o hash.
    second = _run_cli("admin.fix", ["--sector", "rh"], stdin="")
    assert second.returncode == 1
    assert "já existe" in second.stdout
    assert "nada foi alterado" in second.stdout

    hash_result = await session.execute(
        text("SELECT password_hash FROM users WHERE username = 'admin.fix'")
    )
    assert hash_result.scalar_one() == hash_before


async def test_create_admin_rejects_unknown_sector_slug(session) -> None:
    result = _run_cli(
        "admin.orfao",
        ["--sector", "setor-inexistente"],
        stdin="senha-forte-1\nsenha-forte-1\n",
    )
    assert result.returncode == 1
    assert "não encontrado" in result.stdout

    count_result = await session.execute(
        text("SELECT COUNT(*) FROM users WHERE username = 'admin.orfao'")
    )
    assert int(count_result.scalar_one()) == 0
