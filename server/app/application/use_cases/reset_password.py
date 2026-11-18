from app.application.dto import ResetPasswordCommand
from app.application.events import AuditRequested
from app.domain.entities.user import Password, User
from app.domain.exceptions import NotFoundError
from app.domain.ports.clock import Clock
from app.domain.ports.events import EventBus
from app.domain.ports.repositories import SessionRepository, UserRepository
from app.domain.ports.security import PasswordHasher
from app.domain.ports.unit_of_work import UnitOfWork

__all__ = ["ResetPassword", "ResetPasswordCommand"]


class ResetPassword:
    def __init__(
        self,
        users: UserRepository,
        sessions: SessionRepository,
        hasher: PasswordHasher,
        events: EventBus,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._users = users
        self._sessions = sessions
        self._hasher = hasher
        self._events = events
        self._uow = uow
        self._clock = clock

    async def execute(self, command: ResetPasswordCommand) -> User:
        target = await self._users.get_or_raise(
            command.target_id, NotFoundError("Usuário não encontrado.")
        )

        password = Password(command.new_password)
        now = self._clock.now()
        updated = target.with_password_hash(self._hasher.hash(password.value), now)
        active_sessions = await self._sessions.list_active_by_user(target.id)

        async with self._uow:
            await self._users.update(updated)
            for session in active_sessions:
                await self._sessions.update(session.revoke(now))

        await self._events.publish(
            AuditRequested(
                action="user.password_reset",
                entity_type="user",
                entity_id=str(target.id),
                actor_id=command.actor_id,
                metadata={"sessions_revoked": len(active_sessions)},
                ip=command.ip,
            )
        )
        return updated
