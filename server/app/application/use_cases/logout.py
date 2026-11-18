from app.application.dto import LogoutCommand
from app.application.events import AuditRequested
from app.domain.ports.clock import Clock
from app.domain.ports.events import EventBus
from app.domain.ports.repositories import SessionRepository
from app.domain.ports.security import RefreshTokenIssuer
from app.domain.ports.unit_of_work import UnitOfWork

__all__ = ["Logout", "LogoutCommand"]


class Logout:
    def __init__(
        self,
        sessions: SessionRepository,
        refresh_tokens: RefreshTokenIssuer,
        events: EventBus,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._sessions = sessions
        self._refresh_tokens = refresh_tokens
        self._events = events
        self._uow = uow
        self._clock = clock

    async def execute(self, command: LogoutCommand) -> None:
        session = await self._sessions.get_by_refresh_hash(
            self._refresh_tokens.hash(command.refresh_token)
        )
        if session is None or session.revoked_at is not None:
            return

        async with self._uow:
            await self._sessions.update(session.revoke(self._clock.now()))

        await self._events.publish(
            AuditRequested(
                action="auth.logout",
                entity_type="session",
                entity_id=str(session.id),
                actor_id=session.user_id,
                ip=command.ip,
            )
        )
