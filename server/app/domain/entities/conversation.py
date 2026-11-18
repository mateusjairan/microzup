from dataclasses import dataclass, replace
from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from app.domain.exceptions import ValidationError

ConversationKind = Literal["channel", "dm"]


def _dm_key(user_a: UUID, user_b: UUID) -> str:
    ordered = sorted((str(user_a), str(user_b)))
    return f"{ordered[0]}:{ordered[1]}"


@dataclass(frozen=True, slots=True)
class Conversation:
    id: UUID
    kind: ConversationKind
    name: str | None
    sector_id: UUID | None
    dm_key: str | None
    created_by: UUID | None
    created_at: datetime
    archived_at: datetime | None

    @classmethod
    def create_channel(
        cls,
        sector_id: UUID,
        name: str,
        created_by: UUID | None,
        now: datetime,
    ) -> "Conversation":
        return cls(
            id=uuid4(),
            kind="channel",
            name=name,
            sector_id=sector_id,
            dm_key=None,
            created_by=created_by,
            created_at=now,
            archived_at=None,
        )

    def with_name(self, name: str) -> "Conversation":
        return replace(self, name=name)

    @classmethod
    def create_dm(cls, user_a: UUID, user_b: UUID, now: datetime) -> "Conversation":
        if user_a == user_b:
            raise ValidationError("Não é possível abrir uma conversa consigo mesmo.")
        return cls(
            id=uuid4(),
            kind="dm",
            name=None,
            sector_id=None,
            dm_key=_dm_key(user_a, user_b),
            created_by=None,
            created_at=now,
            archived_at=None,
        )


@dataclass(frozen=True, slots=True)
class ConversationMember:
    conversation_id: UUID
    user_id: UUID
    role: str
    joined_at: datetime
    left_at: datetime | None

    @classmethod
    def create(
        cls,
        conversation_id: UUID,
        user_id: UUID,
        now: datetime,
        role: str = "member",
    ) -> "ConversationMember":
        return cls(
            conversation_id=conversation_id,
            user_id=user_id,
            role=role,
            joined_at=now,
            left_at=None,
        )

    def leave(self, now: datetime) -> "ConversationMember":
        from dataclasses import replace

        return replace(self, left_at=now)
