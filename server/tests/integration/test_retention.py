"""Retenção contra Postgres real (plano §8): dados vencidos/não vencidos.

Prova: mensagens vencidas viram soft delete (nunca DELETE físico), arquivos
vencidos saem do disco E da tabela, o AuditSubscriber grava `message.purge` /
`file.purge` com ator sistema (conectando como microzup_app, o papel de
runtime), e a CLI `retention-run` orquestra um ciclo real com SystemClock.
"""

import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from app.application.use_cases.retention import RetentionRunCommand, RunRetention
from app.domain.entities.attachment import Attachment
from app.domain.policies.retention import RetentionPolicy
from app.domain.value_objects.file_name import FileName
from app.domain.value_objects.file_size import FileSize
from app.domain.value_objects.sha256 import Sha256
from app.infrastructure.db.session import create_engine, create_session_factory
from app.infrastructure.db.uow import SqlAlchemyUnitOfWork
from app.infrastructure.events import InMemoryEventBus
from app.infrastructure.storage import LocalDiskStorage
from app.presentation.subscribers import AuditSubscriber
from sqlalchemy import text

from tests.integration.test_search_repository import (
    _make_user,
    _open_dm,
    _send,
)

pytestmark = pytest.mark.integration

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)
OLD = NOW - timedelta(days=45)

APP_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://microzup_app:microzup_dev_app@localhost:55432/microzup_test",
)


async def _backdate(session, table: str, entity_id) -> None:
    await session.execute(
        text(f"UPDATE {table} SET created_at = :old WHERE id = :id"),  # noqa: S608
        {"old": OLD, "id": entity_id},
    )
    await session.commit()


async def test_retention_soft_deletes_old_messages_and_purges_old_files(session, tmp_path) -> None:
    from tests.unit.fakes import FixedClock

    ana = await _make_user(session, "ana.souza")
    bruno = await _make_user(session, "bruno.lima")
    dm = await _open_dm(session, ana, bruno)

    expired_message = await _send(session, dm.id, ana.id, "c1", "desvio antigo e confidencial")
    fresh_message = await _send(session, dm.id, bruno.id, "c2", "conversa recente")
    await _backdate(session, "messages", expired_message.id)

    # Anexo com blob real no disco, vinculado à mensagem vencida.
    from app.infrastructure.db.repositories.attachments import SqlAlchemyAttachmentRepository

    attachments = SqlAlchemyAttachmentRepository(session)
    storage = LocalDiskStorage(tmp_path)
    attachment = Attachment.create(
        uploader_id=ana.id,
        filename=FileName("laudo-vencido.pdf"),
        mime_type="application/pdf",
        size_bytes=FileSize(1024),
        sha256=Sha256("e" * 64),
        storage_path="files/2026/11/velho",
        now=NOW,
    )
    blob = storage.resolve(attachment.storage_path)
    blob.parent.mkdir(parents=True, exist_ok=True)
    blob.write_bytes(b"blob-do-laudo")
    async with SqlAlchemyUnitOfWork(session):
        await attachments.add(attachment.link(expired_message.id))
    await _backdate(session, "attachments", attachment.id)

    # EventBus com o AuditSubscriber conectando como microzup_app (papel de
    # runtime): INSERT no audit_log é permitido; UPDATE/DELETE não seriam.
    bus = InMemoryEventBus()
    app_engine = create_engine(APP_DB_URL)
    app_factory = create_session_factory(app_engine)
    bus.subscribe(AuditSubscriber(app_factory).on_event)

    from app.infrastructure.db.repositories.messages import SqlAlchemyMessageRepository

    use_case = RunRetention(
        messages=SqlAlchemyMessageRepository(session),
        attachments=attachments,
        storage=storage,
        policy=RetentionPolicy(message_retention_days=30, file_retention_days=30),
        events=bus,
        uow=SqlAlchemyUnitOfWork(session),
        clock=FixedClock(NOW),
    )
    result = await use_case.execute(RetentionRunCommand(batch_limit=10))

    assert result.messages_purged == 1
    assert result.files_purged == 1

    # Mensagem vencida: soft delete (nenhum DELETE físico), corpo substituído.
    rows = (
        await session.execute(
            text("SELECT body, deleted_at, deleted_by FROM messages WHERE id = :id"),
            {"id": expired_message.id},
        )
    ).one()
    assert rows.body == "Mensagem removida"
    assert rows.deleted_at is not None
    assert rows.deleted_by is None

    # Mensagem recente intacta.
    fresh_rows = (
        await session.execute(
            text("SELECT body, deleted_at FROM messages WHERE id = :id"),
            {"id": fresh_message.id},
        )
    ).one()
    assert fresh_rows.body == "conversa recente"
    assert fresh_rows.deleted_at is None

    # Arquivo vencido: row sumiu e o blob saiu do disco.
    count = await session.scalar(text("SELECT COUNT(*) FROM attachments"))
    assert int(count or 0) == 0
    assert not blob.exists()

    # Auditoria via subscriber: message.purge e file.purge com ator sistema.
    audit_rows = (
        await session.execute(
            text(
                "SELECT action, actor_id, metadata FROM audit_log "
                "WHERE action IN ('message.purge', 'file.purge') ORDER BY id"
            )
        )
    ).all()
    assert {row.action for row in audit_rows} == {"message.purge", "file.purge"}
    for row in audit_rows:
        assert row.actor_id is None
        assert row.metadata["actor"] == "system"
    purge_row = next(r for r in audit_rows if r.action == "message.purge")
    assert purge_row.metadata["original_body"] == "desvio antigo e confidencial"

    await app_engine.dispose()


async def test_retention_ignores_fresh_data_when_policy_enabled(session, tmp_path) -> None:
    from app.infrastructure.db.repositories.attachments import SqlAlchemyAttachmentRepository
    from app.infrastructure.db.repositories.messages import SqlAlchemyMessageRepository

    from tests.unit.fakes import FixedClock

    ana = await _make_user(session, "ana.souza")
    bruno = await _make_user(session, "bruno.lima")
    dm = await _open_dm(session, ana, bruno)

    message = await _send(session, dm.id, ana.id, "c1", "tudo recente por aqui")

    bus = InMemoryEventBus()
    use_case = RunRetention(
        messages=SqlAlchemyMessageRepository(session),
        attachments=SqlAlchemyAttachmentRepository(session),
        storage=LocalDiskStorage(tmp_path),
        policy=RetentionPolicy(message_retention_days=30, file_retention_days=30),
        events=bus,
        uow=SqlAlchemyUnitOfWork(session),
        clock=FixedClock(NOW),
    )
    result = await use_case.execute(RetentionRunCommand())

    assert result.messages_purged == 0
    assert result.files_purged == 0
    rows = (
        await session.execute(
            text("SELECT body, deleted_at FROM messages WHERE id = :id"), {"id": message.id}
        )
    ).one()
    assert rows.body == "tudo recente por aqui"
    assert rows.deleted_at is None


def _run_cli(env_extra: dict) -> subprocess.CompletedProcess:
    server_root = Path(__file__).resolve().parents[2]
    env = {**os.environ, "APP_ENV": "test", **env_extra}
    return subprocess.run(
        [sys.executable, "-m", "app.cli", "retention-run"],
        cwd=server_root,
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )


def test_cli_retention_run_reports_disabled_policy() -> None:
    result = _run_cli({"MESSAGE_RETENTION_DAYS": "0", "FILE_RETENTION_DAYS": "0"})
    assert result.returncode == 0, result.stdout + result.stderr
    assert "desligada" in result.stdout


async def test_cli_retention_run_executes_a_real_cycle(session, tmp_path) -> None:
    """CLI `retention-run` com retenção ligada: ciclo real com SystemClock.

    DATABASE_URL é sobrescrito para o banco de TESTE com o papel de runtime —
    sem isso a CLI leria o `.env` e tocaria o banco de desenvolvimento.
    """
    from app.infrastructure.db.repositories.attachments import SqlAlchemyAttachmentRepository

    ana = await _make_user(session, "ana.souza")
    bruno = await _make_user(session, "bruno.lima")
    dm = await _open_dm(session, ana, bruno)
    expired = await _send(session, dm.id, ana.id, "c1", "mensagem que vence")
    fresh = await _send(session, dm.id, bruno.id, "c2", "mensagem recente")

    # Backdate relativo ao relógio REAL da máquina (a CLI usa SystemClock).
    old = datetime.now(UTC) - timedelta(days=45)
    attachments = SqlAlchemyAttachmentRepository(session)
    storage = LocalDiskStorage(tmp_path)
    attachment = Attachment.create(
        uploader_id=ana.id,
        filename=FileName("laudo-vencido-cli.pdf"),
        mime_type="application/pdf",
        size_bytes=FileSize(512),
        sha256=Sha256("9" * 64),
        storage_path="files/2026/11/cli-velho",
        now=datetime.now(UTC),
    )
    blob = storage.resolve(attachment.storage_path)
    blob.parent.mkdir(parents=True, exist_ok=True)
    blob.write_bytes(b"blob-cli")
    async with SqlAlchemyUnitOfWork(session):
        await attachments.add(attachment.link(expired.id))
    await session.execute(
        text("UPDATE messages SET created_at = :old WHERE id = :id"),
        {"old": old, "id": expired.id},
    )
    await session.execute(
        text("UPDATE attachments SET created_at = :old WHERE id = :id"),
        {"old": old, "id": attachment.id},
    )
    await session.commit()
    assert blob.exists()

    result = _run_cli(
        {
            "DATABASE_URL": APP_DB_URL,
            "MESSAGE_RETENTION_DAYS": "30",
            "FILE_RETENTION_DAYS": "30",
            "STORAGE_DIR": str(tmp_path),
        }
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Retenção concluída" in result.stdout
    assert "1 mensagem" in result.stdout
    assert "1 arquivo" in result.stdout

    # O blob saiu do disco (a CLI usou o mesmo STORAGE_DIR).
    assert not blob.exists()

    # Mensagem vencida: soft delete; recente intacta.
    expired_row = (
        await session.execute(
            text("SELECT body, deleted_at FROM messages WHERE id = :id"), {"id": expired.id}
        )
    ).one()
    assert expired_row.body == "Mensagem removida"
    assert expired_row.deleted_at is not None
    fresh_row = (
        await session.execute(
            text("SELECT deleted_at FROM messages WHERE id = :id"), {"id": fresh.id}
        )
    ).one()
    assert fresh_row.deleted_at is None

    # A auditoria *.purge foi gravada pelo subscriber dentro da CLI.
    audit = (
        await session.execute(
            text(
                "SELECT action, actor_id, metadata FROM audit_log "
                "WHERE action IN ('message.purge', 'file.purge')"
            )
        )
    ).all()
    assert {row.action for row in audit} == {"message.purge", "file.purge"}
    for row in audit:
        assert row.actor_id is None
        assert row.metadata["actor"] == "system"
