from dataclasses import dataclass
from typing import cast
from uuid import UUID

from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.entities.sector import Sector
from app.domain.entities.user import Password, Role, User, Username
from app.domain.exceptions import NotFoundError, UserAlreadyExists
from app.domain.ports.audit import AuditLogSink
from app.domain.ports.clock import Clock
from app.domain.ports.repositories import ConversationRepository, SectorRepository, UserRepository
from app.domain.ports.security import PasswordHasher
from app.domain.ports.unit_of_work import UnitOfWork


@dataclass(frozen=True, slots=True)
class CreateUserCommand:
    username: str
    display_name: str
    password: str
    role: str = "member"
    sector_id: UUID | None = None
    actor_id: UUID | None = None
    ip: str | None = None


class CreateUser:
    def __init__(
        self,
        users: UserRepository,
        sectors: SectorRepository | None,
        hasher: PasswordHasher,
        audit: AuditLogSink,
        uow: UnitOfWork,
        clock: Clock,
        conversations: ConversationRepository | None = None,
    ) -> None:
        self._users = users
        self._sectors = sectors
        self._hasher = hasher
        self._audit = audit
        self._uow = uow
        self._clock = clock
        self._conversations = conversations

    async def execute(self, command: CreateUserCommand) -> User:
        username = Username(command.username)
        password = Password(command.password)

        if command.role not in ("admin", "member"):
            raise ValueError("role deve ser 'admin' ou 'member'")  # defesa de tipagem

        if command.sector_id is not None and self._sectors is not None:
            sector: Sector | None = None
            for existing in await self._sectors.list_all():
                if existing.id == command.sector_id:
                    sector = existing
                    break
            if sector is None:
                raise NotFoundError("Setor não encontrado.")

        if await self._users.get_by_username(username.value) is not None:
            raise UserAlreadyExists(f"Usuário '{username}' já existe.")

        user = User.create(
            username=username,
            display_name=command.display_name,
            role=cast(Role, command.role),
            sector_id=command.sector_id,
            password_hash=self._hasher.hash(password.value),
            now=self._clock.now(),
        )

        async with self._uow:
            await self._users.add(user)
            if self._conversations is not None and user.sector_id is not None:
                channel = await self._conversations.get_channel_by_sector(user.sector_id)
                if channel is None:
                    channel = Conversation.create_channel(
                        user.sector_id, user.display_name, command.actor_id, self._clock.now()
                    )
                    await self._conversations.add(channel)
                await self._conversations.add_member(
                    ConversationMember.create(channel.id, user.id, self._clock.now())
                )
            await self._audit.record(
                "user.create",
                "user",
                str(user.id),
                command.actor_id,
                {"username": user.username, "role": user.role},
                command.ip,
            )

        return user
