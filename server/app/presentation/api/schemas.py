from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.domain.entities.attachment import Attachment, AttachmentHit
from app.domain.entities.message import Message
from app.domain.entities.user import User


class UserOut(BaseModel):
    id: UUID
    username: str
    display_name: str
    role: str
    sector_id: UUID | None
    is_active: bool

    @classmethod
    def from_user(cls, user: User) -> "UserOut":
        return cls(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            role=user.role,
            sector_id=user.sector_id,
            is_active=user.is_active,
        )


class DirectoryUserOut(UserOut):
    presence: str

    @classmethod
    def from_user_and_presence(cls, user: User, presence: str) -> "DirectoryUserOut":
        return cls(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            role=user.role,
            sector_id=user.sector_id,
            is_active=user.is_active,
            presence=presence,
        )


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str
    device_name: str | None = Field(default=None, max_length=120)


class LoginOut(BaseModel):
    access_token: str
    refresh_token: str
    user: UserOut


class RefreshIn(BaseModel):
    refresh_token: str


class RefreshOut(BaseModel):
    access_token: str
    refresh_token: str


class CreateUserIn(BaseModel):
    username: str
    display_name: str
    password: str
    role: str = "member"
    sector_id: UUID | None = None


class UpdateUserIn(BaseModel):
    role: str | None = None
    sector_id: UUID | None = None
    clear_sector: bool = False
    is_active: bool | None = None


class ResetPasswordIn(BaseModel):
    new_password: str


class CreateSectorIn(BaseModel):
    name: str
    description: str | None = None


class UpdateSectorIn(BaseModel):
    name: str
    description: str | None = None


class SectorOut(BaseModel):
    id: UUID
    name: str
    slug: str
    description: str | None


class ConversationOut(BaseModel):
    id: UUID
    kind: str
    name: str | None
    sector_id: UUID | None
    archived_at: str | None = None
    peer_id: UUID | None = None
    peer_is_active: bool | None = None


class ConversationMemberOut(BaseModel):
    user_id: UUID
    username: str
    display_name: str
    role: str
    presence: str


class MessageOut(BaseModel):
    id: UUID
    seq: int
    conversation_id: UUID
    sender_id: UUID
    client_id: str
    body: str
    created_at: str
    edited_at: str | None
    deleted_at: str | None

    @classmethod
    def from_message(cls, message: Message) -> "MessageOut":
        return cls(
            id=message.id,
            seq=message.seq,
            conversation_id=message.conversation_id,
            sender_id=message.sender_id,
            client_id=message.client_id,
            body=message.body,
            created_at=message.created_at.isoformat(),
            edited_at=message.edited_at.isoformat() if message.edited_at else None,
            deleted_at=message.deleted_at.isoformat() if message.deleted_at else None,
        )


class ConversationSummaryOut(BaseModel):
    conversation: ConversationOut
    unread_count: int
    last_read_seq: int
    last_message: MessageOut | None


class SendMessageIn(BaseModel):
    conversation_id: UUID
    client_id: str
    body: str
    attachment_ids: list[UUID] = []


class AttachmentOut(BaseModel):
    id: UUID
    message_id: UUID | None
    filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    has_thumbnail: bool = False

    @classmethod
    def from_attachment(cls, attachment: Attachment) -> "AttachmentOut":
        return cls(
            id=attachment.id,
            message_id=attachment.message_id,
            filename=attachment.filename,
            mime_type=attachment.mime_type,
            size_bytes=attachment.size_bytes,
            sha256=attachment.sha256,
            has_thumbnail=attachment.thumbnail_path is not None,
        )


class FileHitOut(BaseModel):
    """Anexo achado por nome de arquivo, com a conversa/mensagem de contexto."""

    id: UUID
    filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    has_thumbnail: bool
    message_id: UUID
    conversation_id: UUID
    message_seq: int
    message_created_at: str

    @classmethod
    def from_hit(cls, hit: AttachmentHit) -> "FileHitOut":
        # O repositório só devolve anexos vinculados (INNER JOIN messages).
        assert hit.attachment.message_id is not None
        return cls(
            id=hit.attachment.id,
            filename=hit.attachment.filename,
            mime_type=hit.attachment.mime_type,
            size_bytes=hit.attachment.size_bytes,
            sha256=hit.attachment.sha256,
            has_thumbnail=hit.attachment.thumbnail_path is not None,
            message_id=hit.attachment.message_id,
            conversation_id=hit.conversation_id,
            message_seq=hit.message_seq,
            message_created_at=hit.message_created_at.isoformat(),
        )


class SearchOut(BaseModel):
    """Resposta unificada de /search (plano §5/§6): mensagens + anexos."""

    messages: list[MessageOut]
    files: list[FileHitOut]


class EditMessageIn(BaseModel):
    body: str


class MarkReadIn(BaseModel):
    last_read_seq: int


class OpenDmIn(BaseModel):
    user_id: UUID


class AuditOut(BaseModel):
    id: int
    actor_id: UUID | None
    action: str
    entity_type: str
    entity_id: str | None
    metadata: dict[str, Any]
    ip: str | None
    created_at: str


class StatsOut(BaseModel):
    users: int
    sectors: int
    conversations: int
    messages: int
    attachments: int
    storage_bytes: int = 0
    storage_files: int = 0
    disk_free_bytes: int = 0
    disk_total_bytes: int = 0


class ChannelOut(BaseModel):
    id: UUID
    name: str | None
    sector_id: UUID | None
    sector_name: str | None = None
    member_count: int = 0
    archived_at: str | None = None

    @classmethod
    def from_summary(cls, summary: Any) -> "ChannelOut":
        return cls(
            id=summary.conversation.id,
            name=summary.conversation.name,
            sector_id=summary.conversation.sector_id,
            sector_name=summary.sector.name if summary.sector else None,
            member_count=summary.member_count,
            archived_at=(
                summary.conversation.archived_at.isoformat()
                if summary.conversation.archived_at
                else None
            ),
        )


class UpdateChannelIn(BaseModel):
    name: str | None = None
    archived: bool | None = None
