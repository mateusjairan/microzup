from dataclasses import dataclass

from app.domain.entities.session import UserSession
from app.domain.entities.user import User
from app.domain.exceptions import AuthenticationError, InactiveUserError
from app.domain.ports.audit import AuditLogSink
from app.domain.ports.clock import Clock
from app.domain.ports.repositories import SessionRepository, UserRepository
from app.domain.ports.security import AccessTokenIssuer, PasswordHasher, RefreshTokenIssuer
from app.domain.ports.unit_of_work import UnitOfWork


@dataclass(frozen=True, slots=True)
class LoginCommand:
    username: str
    password: str
    device_name: str | None = None
    ip: str | None = None
    user_agent: str | None = None


@dataclass(frozen=True, slots=True)
class LoginResult:
    user: User
    access_token: str
    refresh_token: str


class Login:
    def __init__(
        self,
        users: UserRepository,
        sessions: SessionRepository,
        hasher: PasswordHasher,
        access_tokens: AccessTokenIssuer,
        refresh_tokens: RefreshTokenIssuer,
        audit: AuditLogSink,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._users = users
        self._sessions = sessions
        self._hasher = hasher
        self._access_tokens = access_tokens
        self._refresh_tokens = refresh_tokens
        self._audit = audit
        self._uow = uow
        self._clock = clock

    async def execute(self, command: LoginCommand) -> LoginResult:
        user = await self._users.get_by_username(command.username.strip().lower())

        if user is None or not self._hasher.verify(command.password, user.password_hash):
            raise AuthenticationError("Usuário ou senha inválidos.")

        if not user.is_active:
            raise InactiveUserError("Usuário desativado. Fale com o administrador.")

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
            await self._audit.record(
                "auth.login",
                "session",
                str(session.id),
                user.id,
                {"device_name": command.device_name},
                command.ip,
            )

        return LoginResult(user=user, access_token=access_token, refresh_token=raw_refresh)
