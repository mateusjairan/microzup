from dataclasses import dataclass
from uuid import UUID

from app.domain.entities.user import Password, User
from app.domain.exceptions import NotFoundError
from app.domain.ports.audit import AuditLogSink
from app.domain.ports.clock import Clock
from app.domain.ports.repositories import SessionRepository, UserRepository
from app.domain.ports.security import PasswordHasher
from app.domain.ports.unit_of_work import UnitOfWork


@dataclass(frozen=True, slots=True)
class ResetPasswordCommand:
    target_id: UUID
    new_password: str
    actor_id: UUID
    ip: str | None = None


class ResetPassword:
    def __init__(
        self,
        users: UserRepository,
        sessions: SessionRepository,
        hasher: PasswordHasher,
        audit: AuditLogSink,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._users = users
        self._sessions = sessions
        self._hasher = hasher
        self._audit = audit
        self._uow = uow
        self._clock = clock

    async def execute(self, command: ResetPasswordCommand) -> User:
        target = await self._users.get_by_id(command.target_id)
        if target is None:
            raise NotFoundError("Usuário não encontrado.")

        password = Password(command.new_password)
        now = self._clock.now()
        updated = target.with_password_hash(self._hasher.hash(password.value), now)
        active_sessions = await self._sessions.list_active_by_user(target.id)

        async with self._uow:
            await self._users.update(updated)
            for session in active_sessions:
                await self._sessions.update(session.revoke(now))
            await self._audit.record(
                "user.password_reset",
                "user",
                str(target.id),
                command.actor_id,
                {"sessions_revoked": len(active_sessions)},
                command.ip,
            )

        return updated
