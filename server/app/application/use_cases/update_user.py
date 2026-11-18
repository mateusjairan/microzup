from dataclasses import dataclass
from typing import cast
from uuid import UUID

from app.domain.entities.user import Role, User
from app.domain.exceptions import NotFoundError
from app.domain.ports.audit import AuditLogSink
from app.domain.ports.clock import Clock
from app.domain.ports.repositories import UserRepository
from app.domain.ports.unit_of_work import UnitOfWork


@dataclass(frozen=True, slots=True)
class UpdateUserCommand:
    target_id: UUID
    actor_id: UUID
    role: str | None = None
    sector_id: UUID | None = None
    clear_sector: bool = False
    is_active: bool | None = None
    ip: str | None = None


class UpdateUser:
    def __init__(
        self,
        users: UserRepository,
        audit: AuditLogSink,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._users = users
        self._audit = audit
        self._uow = uow
        self._clock = clock

    async def execute(self, command: UpdateUserCommand) -> User:
        target = await self._users.get_by_id(command.target_id)
        if target is None:
            raise NotFoundError("Usuário não encontrado.")

        now = self._clock.now()
        updated = target
        changes: dict[str, object] = {}

        if command.is_active is not None and command.is_active != target.is_active:
            updated = updated.with_active(command.is_active, now)
            changes["is_active"] = command.is_active
        if command.role is not None and command.role != target.role:
            updated = updated.with_role(cast(Role, command.role), now)
            changes["role"] = command.role
        if command.sector_id is not None and command.sector_id != target.sector_id:
            updated = updated.with_sector(command.sector_id, now)
            changes["sector_id"] = str(command.sector_id)
        elif command.clear_sector and target.sector_id is not None:
            updated = updated.with_sector(None, now)
            changes["sector_id"] = None

        if not changes:
            return target

        async with self._uow:
            await self._users.update(updated)
            await self._audit.record(
                "user.update",
                "user",
                str(target.id),
                command.actor_id,
                changes,
                command.ip,
            )

        return updated
