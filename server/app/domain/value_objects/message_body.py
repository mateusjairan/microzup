from dataclasses import dataclass

from app.domain.exceptions import ValidationError

BODY_MAX = 8000


@dataclass(frozen=True, slots=True)
class MessageBody:
    """Corpo de mensagem com invariantes validadas no construtor (plano §4.1)."""

    value: str

    def __init__(self, value: str, max_chars: int = BODY_MAX) -> None:
        if not value.strip():
            raise ValidationError("A mensagem não pode ser vazia.")
        if len(value) > max_chars:
            raise ValidationError(f"A mensagem excede {max_chars} caracteres.")
        object.__setattr__(self, "value", value)
