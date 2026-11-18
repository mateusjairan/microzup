import re
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from app.domain.exceptions import ValidationError

Role = Literal["admin", "member"]

_USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,32}$")
PASSWORD_MIN = 8
PASSWORD_MAX = 128
DISPLAY_NAME_MAX = 80


@dataclass(frozen=True, slots=True)
class Username:
    value: str

    def __init__(self, value: str) -> None:
        clean = value.strip().lower()
        if not _USERNAME_RE.fullmatch(clean):
            raise ValidationError(
                "Nome de usuário inválido (3 a 32 caracteres: letras, números, ponto, _ ou -)."
            )
        object.__setattr__(self, "value", clean)

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True, slots=True)
class Password:
    value: str

    def __init__(self, value: str) -> None:
        if not PASSWORD_MIN <= len(value) <= PASSWORD_MAX:
            raise ValidationError(
                f"A senha deve ter entre {PASSWORD_MIN} e {PASSWORD_MAX} caracteres."
            )
        object.__setattr__(self, "value", value)


@dataclass(frozen=True, slots=True)
class User:
    id: UUID
    username: str
    display_name: str
    role: Role
    sector_id: UUID | None
    password_hash: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime | None

    @classmethod
    def create(
        cls,
        username: Username,
        display_name: str,
        role: Role,
        sector_id: UUID | None,
        password_hash: str,
        now: datetime,
    ) -> "User":
        clean_display = " ".join(display_name.split())
        if not 2 <= len(clean_display) <= DISPLAY_NAME_MAX:
            raise ValidationError(
                f"O nome de exibição deve ter entre 2 e {DISPLAY_NAME_MAX} caracteres."
            )
        return cls(
            id=uuid4(),
            username=username.value,
            display_name=clean_display,
            role=role,
            sector_id=sector_id,
            password_hash=password_hash,
            is_active=True,
            created_at=now,
            updated_at=now,
            last_seen_at=None,
        )

    def with_active(self, is_active: bool, now: datetime) -> "User":
        return replace(self, is_active=is_active, updated_at=now)

    def with_role(self, role: Role, now: datetime) -> "User":
        return replace(self, role=role, updated_at=now)

    def with_sector(self, sector_id: UUID | None, now: datetime) -> "User":
        return replace(self, sector_id=sector_id, updated_at=now)

    def with_last_seen(self, now: datetime) -> "User":
        return replace(self, last_seen_at=now)

    def with_password_hash(self, password_hash: str, now: datetime) -> "User":
        return replace(self, password_hash=password_hash, updated_at=now)
