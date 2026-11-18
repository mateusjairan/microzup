from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID, uuid4

from app.domain.exceptions import ValidationError
from app.domain.value_objects.message_body import BODY_MAX, MessageBody

# MessageBody vive em domain/value_objects (plano §4.1); re-export mantém os
# importadores históricos de `entities.message` funcionando.
__all__ = ["BODY_MAX", "CLIENT_ID_MAX", "DELETED_BODY", "Message", "MessageBody"]

CLIENT_ID_MAX = 64
DELETED_BODY = "Mensagem removida"


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

    def delete(self, actor_id: UUID | None, now: datetime) -> "Message":
        """Soft delete: corpo substituído, original preservado na auditoria.

        `actor_id=None` significa ator sistema (ex.: retenção, plano §8) —
        o registro de auditoria correspondente marca o ator como "system".
        """
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
