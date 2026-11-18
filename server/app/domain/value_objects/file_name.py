from dataclasses import dataclass

from app.domain.exceptions import ValidationError

FILENAME_MAX = 255


@dataclass(frozen=True, slots=True)
class FileName:
    """Nome de arquivo sanitizado: plano §8 — o nome nunca vira caminho em disco."""

    value: str

    def __init__(self, value: str, max_chars: int = FILENAME_MAX) -> None:
        clean = value.strip()
        if not clean:
            raise ValidationError("Nome de arquivo inválido.")
        if len(clean) > max_chars:
            raise ValidationError(f"O nome de arquivo excede {max_chars} caracteres.")
        if any(character in clean for character in ("\x00", "/", "\\", ":")):
            raise ValidationError("Nome de arquivo contém caracteres inválidos.")
        object.__setattr__(self, "value", clean)
