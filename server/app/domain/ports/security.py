from typing import Protocol
from uuid import UUID

from app.domain.entities.user import User


class PasswordHasher(Protocol):
    def hash(self, password: str) -> str: ...

    def verify(self, password: str, password_hash: str) -> bool: ...


class AccessTokenIssuer(Protocol):
    def issue(self, user: User) -> str: ...

    def decode(self, token: str) -> UUID: ...


class RefreshTokenIssuer(Protocol):
    def issue(self) -> tuple[str, str]: ...  # (raw, hash)

    def hash(self, raw: str) -> str: ...
