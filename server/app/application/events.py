from dataclasses import dataclass
from uuid import UUID

from app.domain.entities.message import Message


@dataclass(frozen=True, slots=True)
class MessageCreated:
    message: Message
    recipient_ids: frozenset[UUID]


@dataclass(frozen=True, slots=True)
class MessageUpdated:
    message: Message
    recipient_ids: frozenset[UUID]


@dataclass(frozen=True, slots=True)
class MessageDeleted:
    conversation_id: UUID
    message_id: UUID
    recipient_ids: frozenset[UUID]
