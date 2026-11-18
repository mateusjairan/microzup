import re
from dataclasses import dataclass

from app.domain.exceptions import ValidationError

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class Sha256:
    """Digest SHA-256 hexadecimal de 64 caracteres (dedupe de blobs, plano §7)."""

    value: str

    def __init__(self, value: str) -> None:
        if not _SHA256_RE.fullmatch(value):
            raise ValidationError("Digest SHA-256 inválido.")
        object.__setattr__(self, "value", value)
