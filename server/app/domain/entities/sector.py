import re
import unicodedata
from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID, uuid4

from app.domain.exceptions import ValidationError

NAME_MIN = 2
NAME_MAX = 60
DESCRIPTION_MAX = 240


def _clean_name(name: str) -> str:
    clean_name = " ".join(name.split())
    if not NAME_MIN <= len(clean_name) <= NAME_MAX:
        raise ValidationError(f"Nome do setor deve ter entre {NAME_MIN} e {NAME_MAX} caracteres.")
    return clean_name


def _clean_description(description: str | None) -> str | None:
    clean_description = description.strip() if description else None
    if clean_description and len(clean_description) > DESCRIPTION_MAX:
        raise ValidationError(
            f"Descrição do setor deve ter no máximo {DESCRIPTION_MAX} caracteres."
        )
    return clean_description


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only.lower()).strip("-")
    if not slug:
        raise ValidationError("Nome do setor precisa conter letras ou números.")
    return slug


@dataclass(frozen=True, slots=True)
class Sector:
    id: UUID
    name: str
    slug: str
    description: str | None
    created_at: datetime

    @classmethod
    def create(cls, name: str, description: str | None, now: datetime) -> "Sector":
        clean_name = _clean_name(name)
        return cls(
            id=uuid4(),
            name=clean_name,
            slug=slugify(clean_name),
            description=_clean_description(description),
            created_at=now,
        )

    def with_details(self, name: str, description: str | None) -> "Sector":
        clean_name = _clean_name(name)
        return replace(
            self,
            name=clean_name,
            slug=slugify(clean_name),
            description=_clean_description(description),
        )
