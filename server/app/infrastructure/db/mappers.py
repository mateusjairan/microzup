from typing import cast

from app.domain.entities.conversation import Conversation, ConversationKind, ConversationMember
from app.domain.entities.message import Message
from app.domain.entities.sector import Sector
from app.domain.entities.session import UserSession
from app.domain.entities.user import Role, User
from app.infrastructure.db.models import (
    ConversationMemberRow,
    ConversationRow,
    MessageRow,
    SectorRow,
    UserRow,
    UserSessionRow,
)


def sector_to_domain(row: SectorRow) -> Sector:
    return Sector(
        id=row.id,
        name=row.name,
        slug=row.slug,
        description=row.description,
        created_at=row.created_at,
    )


def sector_to_row(sector: Sector) -> SectorRow:
    return SectorRow(
        id=sector.id,
        name=sector.name,
        slug=sector.slug,
        description=sector.description,
        created_at=sector.created_at,
    )


def user_to_domain(row: UserRow) -> User:
    return User(
        id=row.id,
        username=row.username,
        display_name=row.display_name,
        role=cast(Role, row.role),
        sector_id=row.sector_id,
        password_hash=row.password_hash,
        is_active=row.is_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
        last_seen_at=row.last_seen_at,
    )


def user_to_row(user: User) -> UserRow:
    return UserRow(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        password_hash=user.password_hash,
        role=user.role,
        sector_id=user.sector_id,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
        last_seen_at=user.last_seen_at,
    )


def session_to_domain(row: UserSessionRow) -> UserSession:
    return UserSession(
        id=row.id,
        user_id=row.user_id,
        refresh_token_hash=row.refresh_token_hash,
        device_name=row.device_name,
        ip=None if row.ip is None else str(row.ip),
        user_agent=row.user_agent,
        created_at=row.created_at,
        last_used_at=row.last_used_at,
        revoked_at=row.revoked_at,
    )


def session_to_row(session: UserSession) -> UserSessionRow:
    return UserSessionRow(
        id=session.id,
        user_id=session.user_id,
        refresh_token_hash=session.refresh_token_hash,
        device_name=session.device_name,
        ip=session.ip,
        user_agent=session.user_agent,
        created_at=session.created_at,
        last_used_at=session.last_used_at,
        revoked_at=session.revoked_at,
    )


def conversation_to_domain(row: ConversationRow) -> Conversation:
    return Conversation(
        id=row.id,
        kind=cast(ConversationKind, row.kind),
        name=row.name,
        sector_id=row.sector_id,
        dm_key=row.dm_key,
        created_by=row.created_by,
        created_at=row.created_at,
        archived_at=row.archived_at,
    )


def conversation_to_row(conversation: Conversation) -> ConversationRow:
    return ConversationRow(
        id=conversation.id,
        kind=conversation.kind,
        name=conversation.name,
        sector_id=conversation.sector_id,
        dm_key=conversation.dm_key,
        created_by=conversation.created_by,
        created_at=conversation.created_at,
        archived_at=conversation.archived_at,
    )


def member_to_domain(row: ConversationMemberRow) -> ConversationMember:
    return ConversationMember(
        conversation_id=row.conversation_id,
        user_id=row.user_id,
        role=row.role,
        joined_at=row.joined_at,
        left_at=row.left_at,
    )


def member_to_row(member: ConversationMember) -> ConversationMemberRow:
    return ConversationMemberRow(
        conversation_id=member.conversation_id,
        user_id=member.user_id,
        role=member.role,
        joined_at=member.joined_at,
        left_at=member.left_at,
    )


def message_to_domain(row: MessageRow) -> Message:
    return Message(
        id=row.id,
        seq=row.seq,
        conversation_id=row.conversation_id,
        sender_id=row.sender_id,
        client_id=row.client_id,
        body=row.body,
        reply_to_id=row.reply_to_id,
        created_at=row.created_at,
        edited_at=row.edited_at,
        deleted_at=row.deleted_at,
        deleted_by=row.deleted_by,
    )


def message_to_row(message: Message) -> MessageRow:
    return MessageRow(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_id=message.sender_id,
        client_id=message.client_id,
        body=message.body,
        reply_to_id=message.reply_to_id,
        created_at=message.created_at,
        edited_at=message.edited_at,
        deleted_at=message.deleted_at,
        deleted_by=message.deleted_by,
    )
