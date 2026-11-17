"""Utilitários de linha de comando do servidor.

Uso:
    python -m app.cli create-admin --username admin [--display-name "Administrador"]
"""

import argparse
import asyncio
import getpass
import sys

from app.application.use_cases.create_user import CreateUser, CreateUserCommand
from app.config import get_settings
from app.core.compat import configure_event_loop
from app.infrastructure.clock import SystemClock
from app.infrastructure.db.repositories.audit import SqlAlchemyAuditSink
from app.infrastructure.db.repositories.sectors import SqlAlchemySectorRepository
from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
from app.infrastructure.db.session import create_engine, create_session_factory
from app.infrastructure.db.uow import SqlAlchemyUnitOfWork
from app.infrastructure.security import Argon2Hasher


async def _create_admin(username: str, display_name: str) -> int:
    settings = get_settings()
    engine = create_engine(settings.database_url)
    factory = create_session_factory(engine)
    async with factory() as session:
        users = SqlAlchemyUserRepository(session)
        if await users.get_by_username(username) is not None:
            print(f"Usuário '{username}' já existe; nada foi alterado.")
            await engine.dispose()
            return 1

        password = getpass.getpass("Senha: ")
        confirmation = getpass.getpass("Confirme a senha: ")
        if password != confirmation:
            print("As senhas não conferem.")
            await engine.dispose()
            return 1

        use_case = CreateUser(
            users=users,
            sectors=SqlAlchemySectorRepository(session),
            hasher=Argon2Hasher(),
            audit=SqlAlchemyAuditSink(session),
            uow=SqlAlchemyUnitOfWork(session),
            clock=SystemClock(),
        )
        user = await use_case.execute(
            CreateUserCommand(
                username=username,
                display_name=display_name or username,
                password=password,
                role="admin",
                actor_id=None,
                ip=None,
            )
        )
        print(f"Administrador criado: {user.username} ({user.id})")

    await engine.dispose()
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create-admin", help="cria o primeiro administrador")
    create.add_argument("--username", required=True)
    create.add_argument("--display-name", default=None)

    args = parser.parse_args()

    if args.command == "create-admin":
        configure_event_loop()
        sys.exit(asyncio.run(_create_admin(args.username, args.display_name)))


if __name__ == "__main__":
    main()
