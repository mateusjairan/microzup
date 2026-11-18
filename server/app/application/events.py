from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.domain.entities.attachment import Attachment
from app.domain.entities.message import Message


@dataclass(frozen=True, slots=True)
class MessageCreated:
    message: Message
    recipient_ids: frozenset[UUID]
    attachment_ids: frozenset[UUID] = frozenset()


@dataclass(frozen=True, slots=True)
class MessageUpdated:
    message: Message
    recipient_ids: frozenset[UUID]


@dataclass(frozen=True, slots=True)
class MessageDeleted:
    conversation_id: UUID
    message_id: UUID
    recipient_ids: frozenset[UUID]


@dataclass(frozen=True, slots=True)
class ReadUpdated:
    """Marcação de leitura concluída → evento `read.updated` para os membros."""

    conversation_id: UUID
    user_id: UUID
    last_read_seq: int
    recipient_ids: frozenset[UUID]


@dataclass(frozen=True, slots=True)
class UserDeactivated:
    """Usuário desativado → revogar sessões e fechar sockets WS abertos."""

    user_id: UUID


@dataclass(frozen=True, slots=True)
class AttachmentReady:
    """Upload processado (blob + prévia) → evento `attachment.ready` para o uploader."""

    attachment: Attachment
    recipient_ids: frozenset[UUID]


@dataclass(frozen=True, slots=True)
class NudgeSent:
    """ "Chamar atenção" entregue → evento `nudge` aos destinatários elegíveis."""

    conversation_id: UUID
    sender_id: UUID
    sender_name: str
    recipient_ids: frozenset[UUID]


@dataclass(frozen=True, slots=True)
class AuditRequested:
    """Caso de uso concluído → o auditor (subscriber do EventBus) grava o audit_log.

    Publicado DEPOIS da transação do caso de uso (plano §4.3): a auditoria
    reage ao evento, nunca é chamada dentro da regra de negócio. `actor_id`
    é `None` quando o ator é o sistema (ex.: retenção, bootstrap via CLI).
    """

    action: str
    entity_type: str
    entity_id: str | None
    actor_id: UUID | None
    metadata: dict[str, Any] = field(default_factory=dict)
    ip: str | None = None
