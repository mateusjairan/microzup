from dataclasses import dataclass

from app.domain.entities.session import UserSession
from app.domain.exceptions import InactiveUserError, InvalidTokenError
from app.domain.ports.audit import AuditLogSink
from app.domain.ports.clock import Clock
from app.domain.ports.repositories import SessionRepository, UserRepository
from app.domain.ports.security import AccessTokenIssuer, RefreshTokenIssuer
from app.domain.ports.unit_of_work import UnitOfWork


@dataclass(frozen=True, slots=True)
class RefreshCommand:
    refresh_token: str
    ip: str | None = None


@dataclass(frozen=True, slots=True)
class RefreshResult:
    access_token: str
    refresh_token: str


class Refresh:
    def __init__(
        self,
        users: UserRepository,
        sessions: SessionRepository,
        access_tokens: AccessTokenIssuer,
        refresh_tokens: RefreshTokenIssuer,
        audit: AuditLogSink,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._users = users
        self._sessions = sessions
        self._access_tokens = access_tokens
        self._refresh_tokens = refresh_tokens
        self._audit = audit
        self._uow = uow
        self._clock = clock

    async def execute(self, command: RefreshCommand) -> RefreshResult:
        session = await self._sessions.get_by_refresh_hash(
            self._refresh_tokens.hash(command.refresh_token)
        )

        if session is None or session.revoked_at is not None:
            raise InvalidTokenError("Sessão inválida ou expirada.")

        user = await self._users.get_by_id(session.user_id)
        if user is None or not user.is_active:
            raise InactiveUserError("Usuário desativado.")

        now = self._clock.now()
        access_token = self._access_tokens.issue(user)
        raw_refresh, refresh_hash = self._refresh_tokens.issue()
        new_session = UserSession.create(
            user_id=user.id,
            refresh_token_hash=refresh_hash,
            device_name=session.device_name,
            ip=command.ip,
            user_agent=session.user_agent,
            now=now,
        )

        async with self._uow:
            await self._sessions.update(session.revoke(now))
            await self._sessions.add(new_session)
            await self._audit.record(
                "auth.refresh",
                "session",
                str(new_session.id),
                user.id,
                None,
                command.ip,
            )

        return RefreshResult(access_token=access_token, refresh_token=raw_refresh)
