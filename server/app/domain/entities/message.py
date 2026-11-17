from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID, uuid4

from app.domain.exceptions import ValidationError

BODY_MAX = 8000
CLIENT_ID_MAX = 64
DELETED_BODY = "Mensagem removida"


@dataclass(frozen=True, slots=True)
class MessageBody:
    value: str

    def __init__(self, value: str) -> None:
        if not value.strip():
            raise ValidationError("A mensagem não pode ser vazia.")
        if len(value) > BODY_MAX:
            raise ValidationError(f"A mensagem excede {BODY_MAX} caracteres.")
        object.__setattr__(self, "value", value)


@dataclass(frozen=True, slots=True)
class Message:
    id: UUID
    seq: int
    conversation_id: UUID
    sender_id: UUID
    client_id: str
    body: str
    reply_to_id: UUID | None
    created_at: datetime
    edited_at: datetime | None
    deleted_at: datetime | None
    deleted_by: UUID | None

    @classmethod
    def create(
        cls,
        conversation_id: UUID,
        sender_id: UUID,
        client_id: str,
        body: MessageBody,
        now: datetime,
    ) -> "Message":
        if not client_id or len(client_id) > CLIENT_ID_MAX:
            raise ValidationError("client_id inválido.")
        return cls(
            id=uuid4(),
            seq=0,
            conversation_id=conversation_id,
            sender_id=sender_id,
            client_id=client_id,
            body=body.value,
            reply_to_id=None,
            created_at=now,
            edited_at=None,
            deleted_at=None,
            deleted_by=None,
        )

    def with_seq(self, seq: int) -> "Message":
        return replace(self, seq=seq)

    def edit(self, body: MessageBody, now: datetime) -> "Message":
        return replace(self, body=body.value, edited_at=now)

    def delete(self, actor_id: UUID, now: datetime) -> "Message":
        return replace(
            self,
            body=DELETED_BODY,
            deleted_at=now,
            deleted_by=actor_id,
            edited_at=None,
        )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None
