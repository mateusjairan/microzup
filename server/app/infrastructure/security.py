import hashlib
import secrets
from datetime import timedelta
from typing import Any
from uuid import UUID

import jwt
from argon2 import PasswordHasher as Argon2PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.domain.entities.user import User
from app.domain.ports.clock import Clock


class Argon2Hasher:
    def __init__(self) -> None:
        self._hasher = Argon2PasswordHasher()

    def hash(self, password: str) -> str:
        return self._hasher.hash(password)

    def verify(self, password: str, password_hash: str) -> bool:
        try:
            return self._hasher.verify(password_hash, password)
        except (VerifyMismatchError, InvalidHashError):
            return False


class JwtAccessTokenIssuer:
    def __init__(self, secret: str, ttl_minutes: int, clock: Clock) -> None:
        self._secret = secret
        self._ttl = timedelta(minutes=ttl_minutes)
        self._clock = clock

    def issue(self, user: User) -> str:
        now = self._clock.now()
        payload: dict[str, Any] = {
            "sub": str(user.id),
            "role": user.role,
            "iat": int(now.timestamp()),
            "exp": int((now + self._ttl).timestamp()),
        }
        return jwt.encode(payload, self._secret, algorithm="HS256")

    def decode(self, token: str) -> UUID:
        payload = jwt.decode(token, self._secret, algorithms=["HS256"])
        return UUID(str(payload["sub"]))


class Sha256RefreshTokenIssuer:
    def issue(self) -> tuple[str, str]:
        raw = secrets.token_urlsafe(48)
        return raw, self.hash(raw)

    def hash(self, raw: str) -> str:
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()
