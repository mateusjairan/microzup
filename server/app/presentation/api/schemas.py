from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.domain.entities.attachment import Attachment
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
    peer_id: UUID | None = None


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

    @classmethod
    def from_attachment(cls, attachment: Attachment) -> "AttachmentOut":
        return cls(
            id=attachment.id,
            message_id=attachment.message_id,
            filename=attachment.filename,
            mime_type=attachment.mime_type,
            size_bytes=attachment.size_bytes,
            sha256=attachment.sha256,
        )


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
