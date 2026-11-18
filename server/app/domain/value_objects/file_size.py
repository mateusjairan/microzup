from dataclasses import dataclass

from app.domain.exceptions import ValidationError


@dataclass(frozen=True, slots=True)
class FileSize:
    """Tamanho de arquivo em bytes; o limite por upload é injetado no construtor."""

    value: int

    def __init__(self, value: int, max_bytes: int | None = None) -> None:
        if value < 0:
            raise ValidationError("Tamanho de arquivo inválido.")
        if max_bytes is not None and value > max_bytes:
            raise ValidationError(f"Arquivo excede o limite de {max_bytes // (1024 * 1024)} MB.")
        object.__setattr__(self, "value", value)
