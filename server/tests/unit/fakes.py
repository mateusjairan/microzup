from dataclasses import dataclass, field
from datetime import datetime
from types import TracebackType
from typing import Any
from uuid import UUID

from app.domain.entities.sector import Sector
from app.domain.entities.session import UserSession
from app.domain.entities.user import User


class FixedClock:
    def __init__(self, now: datetime) -> None:
        self.now_value = now

    def now(self) -> datetime:
        return self.now_value


@dataclass
class FakeSectorRepository:
    sectors: list[Sector] = field(default_factory=list)

    async def add(self, sector: Sector) -> None:
        self.sectors.append(sector)

    async def get_by_slug(self, slug: str) -> Sector | None:
        return next((s for s in self.sectors if s.slug == slug), None)

    async def get_by_name(self, name: str) -> Sector | None:
        return next((s for s in self.sectors if s.name == name), None)

    async def list_all(self) -> list[Sector]:
        return list(self.sectors)


@dataclass
class FakeUserRepository:
    users: list[User] = field(default_factory=list)

    async def add(self, user: User) -> None:
        self.users.append(user)

    async def update(self, user: User) -> None:
        self.users = [user if u.id == user.id else u for u in self.users]

    async def get_by_id(self, user_id: UUID) -> User | None:
        return next((u for u in self.users if u.id == user_id), None)

    async def get_by_username(self, username: str) -> User | None:
        return next((u for u in self.users if u.username == username.lower()), None)

    async def list_active(self) -> list[User]:
        return [u for u in self.users if u.is_active]


@dataclass
class FakeSessionRepository:
    sessions: list[UserSession] = field(default_factory=list)

    async def add(self, session: UserSession) -> None:
        self.sessions.append(session)

    async def update(self, session: UserSession) -> None:
        self.sessions = [session if s.id == session.id else s for s in self.sessions]

    async def get_by_refresh_hash(self, refresh_hash: str) -> UserSession | None:
        return next((s for s in self.sessions if s.refresh_token_hash == refresh_hash), None)


class FakeHasher:
    def hash(self, password: str) -> str:
        return f"argon2:{password}"

    def verify(self, password: str, password_hash: str) -> bool:
        return password_hash == f"argon2:{password}"


class FakeAccessTokenIssuer:
    def issue(self, user: User) -> str:
        return f"access:{user.id}"

    def decode(self, token: str) -> UUID:
        return UUID(token.split(":", 1)[1])


@dataclass
class FakeRefreshTokenIssuer:
    counter: int = 0
    raw_by_hash: dict[str, str] = field(default_factory=dict)

    def issue(self) -> tuple[str, str]:
        self.counter += 1
        raw = f"refresh:{self.counter}"
        hashed = self.hash(raw)
        self.raw_by_hash[hashed] = raw
        return raw, hashed

    def hash(self, raw: str) -> str:
        return f"sha:{raw}"


@dataclass
class FakeAuditSink:
    records: list[dict[str, Any]] = field(default_factory=list)

    async def record(
        self,
        action: str,
        entity_type: str,
        entity_id: str | None,
        actor_id: UUID | None,
        metadata: dict[str, Any] | None,
        ip: str | None,
    ) -> None:
        self.records.append(
            {
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "actor_id": actor_id,
                "metadata": metadata or {},
                "ip": ip,
            }
        )


@dataclass
class FakeUnitOfWork:
    commits: int = 0
    rollbacks: int = 0

    async def __aenter__(self) -> "FakeUnitOfWork":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if exc_type is None:
            self.commits += 1
        else:
            self.rollbacks += 1
