from typing import Protocol

from app.application.dto import LoginCommand, LoginResult
from app.application.events import AuditRequested
from app.domain.entities.session import UserSession
from app.domain.exceptions import (
    AuthenticationError,
    InactiveUserError,
    TooManyAttemptsError,
)
from app.domain.ports.clock import Clock
from app.domain.ports.events import EventBus
from app.domain.ports.repositories import SessionRepository, UserRepository
from app.domain.ports.security import AccessTokenIssuer, PasswordHasher, RefreshTokenIssuer
from app.domain.ports.unit_of_work import UnitOfWork

__all__ = ["Login", "LoginCommand", "LoginResult"]


class LoginAttemptTracker(Protocol):
    """Porta do bloqueio progressivo (plano §8): N falhas por IP+usuário bloqueiam por tempo."""

    def blocked_for(self, key: str) -> float: ...

    def register_failure(self, key: str) -> None: ...

    def register_success(self, key: str) -> None: ...


def attempt_key(command: LoginCommand) -> str:
    return f"{command.ip or 'unknown'}|{command.username.strip().lower()}"


class Login:
    def __init__(
        self,
        users: UserRepository,
        sessions: SessionRepository,
        hasher: PasswordHasher,
        access_tokens: AccessTokenIssuer,
        refresh_tokens: RefreshTokenIssuer,
        events: EventBus,
        uow: UnitOfWork,
        clock: Clock,
        attempts: LoginAttemptTracker | None = None,
    ) -> None:
        self._users = users
        self._sessions = sessions
        self._hasher = hasher
        self._access_tokens = access_tokens
        self._refresh_tokens = refresh_tokens
        self._events = events
        self._uow = uow
        self._clock = clock
        self._attempts = attempts

    async def execute(self, command: LoginCommand) -> LoginResult:
        key = attempt_key(command)

        if self._attempts is not None and self._attempts.blocked_for(key) > 0:
            wait_seconds = int(self._attempts.blocked_for(key))
            raise TooManyAttemptsError(
                f"Muitas tentativas malsucedidas. Tente novamente em {wait_seconds} segundos."
            )

        user = await self._users.get_by_username(command.username.strip().lower())

        if user is None or not self._hasher.verify(command.password, user.password_hash):
            if self._attempts is not None:
                self._attempts.register_failure(key)
            raise AuthenticationError("Usuário ou senha inválidos.")

        if not user.is_active:
            # Senha correta, conta desativada: não conta como falha para o bloqueio.
            raise InactiveUserError("Usuário desativado. Fale com o administrador.")

        if self._attempts is not None:
            self._attempts.register_success(key)

        now = self._clock.now()
        access_token = self._access_tokens.issue(user)
        raw_refresh, refresh_hash = self._refresh_tokens.issue()
        session = UserSession.create(
            user_id=user.id,
            refresh_token_hash=refresh_hash,
            device_name=command.device_name,
            ip=command.ip,
            user_agent=command.user_agent,
            now=now,
        )

        async with self._uow:
            await self._sessions.add(session)
            await self._users.update(user.with_last_seen(now))

        await self._events.publish(
            AuditRequested(
                action="auth.login",
                entity_type="session",
                entity_id=str(session.id),
                actor_id=user.id,
                metadata={"device_name": command.device_name},
                ip=command.ip,
            )
        )

        return LoginResult(user=user, access_token=access_token, refresh_token=raw_refresh)
