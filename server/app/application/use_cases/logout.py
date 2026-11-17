from dataclasses import dataclass

from app.domain.ports.audit import AuditLogSink
from app.domain.ports.clock import Clock
from app.domain.ports.repositories import SessionRepository
from app.domain.ports.security import RefreshTokenIssuer
from app.domain.ports.unit_of_work import UnitOfWork


@dataclass(frozen=True, slots=True)
class LogoutCommand:
    refresh_token: str
    ip: str | None = None


class Logout:
    def __init__(
        self,
        sessions: SessionRepository,
        refresh_tokens: RefreshTokenIssuer,
        audit: AuditLogSink,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._sessions = sessions
        self._refresh_tokens = refresh_tokens
        self._audit = audit
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
            await self._audit.record(
                "auth.logout",
                "session",
                str(session.id),
                session.user_id,
                None,
                command.ip,
            )
