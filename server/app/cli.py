"""Utilitários de linha de comando do servidor.

Uso:
    python -m app.cli create-admin --username admin [--display-name "Administrador"] [--sector ti]
    python -m app.cli retention-run
"""

import argparse
import asyncio
import getpass
import sys
from uuid import UUID

from app.application.audit import apply_audit
from app.application.dto import CreateUserCommand, RetentionRunCommand
from app.application.use_cases.create_user import CreateUser
from app.application.use_cases.retention import RunRetention
from app.config import get_settings
from app.core.compat import configure_event_loop
from app.domain.policies.retention import RetentionPolicy
from app.infrastructure.clock import SystemClock
from app.infrastructure.db.repositories.attachments import SqlAlchemyAttachmentRepository
from app.infrastructure.db.repositories.conversations import SqlAlchemyConversationRepository
from app.infrastructure.db.repositories.messages import SqlAlchemyMessageRepository
from app.infrastructure.db.repositories.sectors import SqlAlchemySectorRepository
from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
from app.infrastructure.db.session import create_engine, create_session_factory
from app.infrastructure.db.uow import SqlAlchemyUnitOfWork
from app.infrastructure.events import InMemoryEventBus
from app.infrastructure.security import Argon2Hasher
from app.infrastructure.storage import LocalDiskStorage
from app.presentation.subscribers import AuditSubscriber

# Retenção: lotes de 500 por transação, até 400 rodadas (200 mil itens por execução).
RETENTION_BATCH_LIMIT = 500
RETENTION_MAX_ROUNDS = 400


def _read_password(prompt: str) -> str:
    """getpass no TTY; stdin direto em pipe de automação/teste.

    No Windows, getpass com stdin canalizado leria do CONSOLE e travaria;
    fora de TTY lemos do stdin (nunca de argumento, variável de ambiente ou histórico).
    """
    if sys.stdin is not None and sys.stdin.isatty():
        return getpass.getpass(prompt)
    print(f"aviso: {prompt} lido de stdin não-interativo (pode ser ecoado)", file=sys.stderr)
    return sys.stdin.readline().rstrip("\r\n")


async def _create_admin(username: str, display_name: str, sector_slug: str | None) -> int:
    settings = get_settings()
    engine = create_engine(settings.database_url)
    factory = create_session_factory(engine)
    async with factory() as session:
        users = SqlAlchemyUserRepository(session)
        if await users.get_by_username(username) is not None:
            # Idempotente: recusa sem sobrescrever a senha (plano §8).
            print(f"Usuário '{username}' já existe; nada foi alterado.")
            await engine.dispose()
            return 1

        sectors = SqlAlchemySectorRepository(session)
        sector_id: UUID | None = None
        if sector_slug is not None:
            sector = await sectors.get_by_slug(sector_slug)
            if sector is None:
                print(f"Setor '{sector_slug}' não encontrado (use o slug, não o nome).")
                await engine.dispose()
                return 1
            sector_id = sector.id

        password = _read_password("Senha: ")
        confirmation = _read_password("Confirme a senha: ")
        if password != confirmation:
            print("As senhas não conferem.")
            await engine.dispose()
            return 1

        # Auditoria via EventBus: mesmo fora do servidor, o subscriber grava o log.
        bus = InMemoryEventBus()
        bus.subscribe(AuditSubscriber(factory).on_event)

        use_case = CreateUser(
            users=users,
            sectors=sectors,
            hasher=Argon2Hasher(),
            uow=SqlAlchemyUnitOfWork(session),
            clock=SystemClock(),
            conversations=SqlAlchemyConversationRepository(session),
        )
        apply_audit(
            use_case,
            bus,
            # Bootstrap audita como user.bootstrap (plano §8), não user.create.
            action=lambda cmd: cmd.audit_action,
            entity_type="user",
            entity_id=lambda cmd, result: str(result.id),
            actor=lambda cmd: cmd.actor_id,
            metadata=lambda cmd, result: {"username": result.username, "role": result.role},
            ip=lambda cmd: cmd.ip,
        )
        user = await use_case.execute(
            CreateUserCommand(
                username=username,
                display_name=display_name or username,
                password=password,
                role="admin",
                sector_id=sector_id,
                actor_id=None,
                ip=None,
                audit_action="user.bootstrap",
            )
        )
        print(f"Administrador criado: {user.username} ({user.id})")

    await engine.dispose()
    return 0


async def _run_retention() -> int:
    """Executa a política de retenção até esgotar (lotes transacionados)."""
    settings = get_settings()
    policy = RetentionPolicy(
        message_retention_days=settings.message_retention_days,
        file_retention_days=settings.file_retention_days,
    )
    if not policy.enabled:
        print(
            "Retenção desligada (MESSAGE_RETENTION_DAYS e FILE_RETENTION_DAYS = 0). "
            "Nada a fazer; para habilitar, defina os dias no .env."
        )
        return 0

    engine = create_engine(settings.database_url)
    factory = create_session_factory(engine)
    bus = InMemoryEventBus()
    bus.subscribe(AuditSubscriber(factory).on_event)
    storage = LocalDiskStorage(settings.storage_dir)

    total_messages = 0
    total_files = 0
    async with factory() as session:
        use_case = RunRetention(
            messages=SqlAlchemyMessageRepository(session),
            attachments=SqlAlchemyAttachmentRepository(session),
            storage=storage,
            policy=policy,
            events=bus,
            uow=SqlAlchemyUnitOfWork(session),
            clock=SystemClock(),
        )
        for _ in range(RETENTION_MAX_ROUNDS):
            result = await use_case.execute(RetentionRunCommand(batch_limit=RETENTION_BATCH_LIMIT))
            total_messages += result.messages_purged
            total_files += result.files_purged
            if result.messages_purged == 0 and result.files_purged == 0:
                break
        else:
            print(
                "Aviso: atingiu o limite de rodadas; reexecute `retention-run` "
                "para continuar de onde parou."
            )

    await engine.dispose()
    print(
        "Retenção concluída: "
        f"{total_messages} mensagem(ns) removidas por soft delete, "
        f"{total_files} arquivo(s) expurgados do disco. "
        "Auditoria registrada como message.purge / file.purge (ator sistema)."
    )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create-admin", help="cria o primeiro administrador")
    create.add_argument("--username", required=True)
    create.add_argument("--display-name", default=None)
    create.add_argument(
        "--sector",
        default=None,
        help="slug do setor (opcional); sem setor o admin não vê canais até ser alocado",
    )

    subparsers.add_parser(
        "retention-run",
        help="aplica MESSAGE_RETENTION_DAYS / FILE_RETENTION_DAYS uma vez e sai",
    )

    args = parser.parse_args()

    if args.command == "create-admin":
        configure_event_loop()
        sys.exit(asyncio.run(_create_admin(args.username, args.display_name, args.sector)))
    elif args.command == "retention-run":
        configure_event_loop()
        sys.exit(asyncio.run(_run_retention()))


if __name__ == "__main__":
    main()
