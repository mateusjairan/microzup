"""Comandos e resultados dos casos de uso (plano §3: `application/dto.py`).

Toda entrada de caso de uso é um comando congelado definido aqui; os módulos
em `use_cases/` re-exportam os nomes para manter os importadores históricos.
"""

from collections.abc import AsyncIterable
from dataclasses import dataclass
from uuid import UUID

from app.domain.entities.attachment import AttachmentHit
from app.domain.entities.conversation import Conversation
from app.domain.entities.message import Message
from app.domain.entities.sector import Sector
from app.domain.entities.user import User

# ── Identidade ────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class LoginCommand:
    username: str
    password: str
    device_name: str | None = None
    ip: str | None = None
    user_agent: str | None = None


@dataclass(frozen=True, slots=True)
class LoginResult:
    user: User
    access_token: str
    refresh_token: str


@dataclass(frozen=True, slots=True)
class RefreshCommand:
    refresh_token: str
    ip: str | None = None


@dataclass(frozen=True, slots=True)
class RefreshResult:
    access_token: str
    refresh_token: str


@dataclass(frozen=True, slots=True)
class LogoutCommand:
    refresh_token: str
    ip: str | None = None


# ── Admin: usuários e setores ──────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class CreateUserCommand:
    username: str
    display_name: str
    password: str
    role: str = "member"
    sector_id: UUID | None = None
    actor_id: UUID | None = None
    ip: str | None = None
    # O bootstrap via CLI audita como "user.bootstrap" (plano §8), não "user.create".
    audit_action: str = "user.create"


@dataclass(frozen=True, slots=True)
class UpdateUserCommand:
    target_id: UUID
    actor_id: UUID
    role: str | None = None
    sector_id: UUID | None = None
    clear_sector: bool = False
    is_active: bool | None = None
    ip: str | None = None


@dataclass(frozen=True, slots=True)
class ResetPasswordCommand:
    target_id: UUID
    new_password: str
    actor_id: UUID
    ip: str | None = None


@dataclass(frozen=True, slots=True)
class CreateSectorCommand:
    name: str
    description: str | None = None
    actor_id: UUID | None = None
    ip: str | None = None


@dataclass(frozen=True, slots=True)
class UpdateSectorCommand:
    target_id: UUID
    name: str
    description: str | None
    actor_id: UUID | None = None
    ip: str | None = None


# ── Conversas ─────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class OpenDirectMessageCommand:
    actor_id: UUID
    other_user_id: UUID


@dataclass(frozen=True, slots=True)
class OpenDirectMessageResult:
    conversation: Conversation
    peer_id: UUID | None
    peer_is_active: bool | None


@dataclass(frozen=True, slots=True)
class ConversationSummary:
    conversation: Conversation
    unread_count: int
    last_read_seq: int
    last_message: Message | None
    peer_id: UUID | None = None
    peer_is_active: bool | None = None


@dataclass(frozen=True, slots=True)
class ListConversationMembersCommand:
    conversation_id: UUID
    requester_id: UUID


@dataclass(frozen=True, slots=True)
class ConversationMemberInfo:
    user: User
    conversation_role: str
    presence: str


@dataclass(frozen=True, slots=True)
class GetConversationAudienceCommand:
    conversation_id: UUID
    requester_id: UUID


@dataclass(frozen=True, slots=True)
class ChannelSummary:
    conversation: Conversation
    sector: Sector | None
    member_count: int


@dataclass(frozen=True, slots=True)
class UpdateChannelCommand:
    channel_id: UUID
    actor_id: UUID
    name: str | None = None
    archived: bool | None = None
    ip: str | None = None


# ── Mensagens ─────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class SendMessageCommand:
    conversation_id: UUID
    sender_id: UUID
    client_id: str
    body: str
    attachment_ids: frozenset[UUID] = frozenset()


@dataclass(frozen=True, slots=True)
class EditMessageCommand:
    message_id: UUID
    actor_id: UUID
    body: str


@dataclass(frozen=True, slots=True)
class DeleteMessageCommand:
    message_id: UUID
    actor_id: UUID


@dataclass(frozen=True, slots=True)
class MarkReadCommand:
    conversation_id: UUID
    user_id: UUID
    last_read_seq: int


@dataclass(frozen=True, slots=True)
class ListMessagesCommand:
    conversation_id: UUID
    user_id: UUID
    before_seq: int | None = None
    after_seq: int | None = None
    limit: int = 50


# ── Busca ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class SearchMessagesCommand:
    user_id: UUID
    query: str
    conversation_id: UUID | None = None
    limit: int = 30


@dataclass(frozen=True, slots=True)
class SearchMessagesResult:
    messages: list[Message]
    files: list[AttachmentHit]


# ── Arquivos ───────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class UploadFileCommand:
    uploader_id: UUID
    filename: str
    content: AsyncIterable[bytes]
    max_size_bytes: int


@dataclass(frozen=True, slots=True)
class DownloadFileCommand:
    attachment_id: UUID
    actor_id: UUID
    ip: str | None = None
    thumbnail: bool = False


# ── WebSocket ──────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class WsHelloCommand:
    user_id: UUID


@dataclass(frozen=True, slots=True)
class WsHelloResult:
    user: User
    conversation_ids: frozenset[UUID]


# ── Nudge ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class NudgeCommand:
    conversation_id: UUID
    sender_id: UUID


@dataclass(frozen=True, slots=True)
class NudgeResult:
    delivered: bool
    reason: str | None = None  # "throttled" | "unavailable" | "dnd"
    recipient_ids: frozenset[UUID] = frozenset()


# ── Retenção (plano §8) ────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class RetentionRunCommand:
    batch_limit: int = 500


@dataclass(frozen=True, slots=True)
class RetentionRunResult:
    messages_purged: int
    files_purged: int
