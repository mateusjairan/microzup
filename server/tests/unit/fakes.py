from dataclasses import dataclass, field
from datetime import datetime
from types import TracebackType
from typing import Any
from uuid import UUID

from app.domain.entities.attachment import Attachment
from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.entities.message import Message
from app.domain.entities.sector import Sector
from app.domain.entities.session import UserSession
from app.domain.entities.user import User


class FixedClock:
    def __init__(self, now: datetime) -> None:
        self.now_value = now

    def now(self) -> datetime:
        return self.now_value


@dataclass
class FakeSectorRepository:
    sectors: list[Sector] = field(default_factory=list)

    async def add(self, sector: Sector) -> None:
        self.sectors.append(sector)

    async def get_by_slug(self, slug: str) -> Sector | None:
        return next((s for s in self.sectors if s.slug == slug), None)

    async def get_by_name(self, name: str) -> Sector | None:
        return next((s for s in self.sectors if s.name == name), None)

    async def list_all(self) -> list[Sector]:
        return list(self.sectors)


@dataclass
class FakeUserRepository:
    users: list[User] = field(default_factory=list)

    async def add(self, user: User) -> None:
        self.users.append(user)

    async def update(self, user: User) -> None:
        self.users = [user if u.id == user.id else u for u in self.users]

    async def get_by_id(self, user_id: UUID) -> User | None:
        return next((u for u in self.users if u.id == user_id), None)

    async def get_by_username(self, username: str) -> User | None:
        return next((u for u in self.users if u.username == username.lower()), None)

    async def list_active(self) -> list[User]:
        return [u for u in self.users if u.is_active]


@dataclass
class FakeSessionRepository:
    sessions: list[UserSession] = field(default_factory=list)

    async def add(self, session: UserSession) -> None:
        self.sessions.append(session)

    async def update(self, session: UserSession) -> None:
        self.sessions = [session if s.id == session.id else s for s in self.sessions]

    async def get_by_refresh_hash(self, refresh_hash: str) -> UserSession | None:
        return next((s for s in self.sessions if s.refresh_token_hash == refresh_hash), None)


class FakeHasher:
    def hash(self, password: str) -> str:
        return f"argon2:{password}"

    def verify(self, password: str, password_hash: str) -> bool:
        return password_hash == f"argon2:{password}"


class FakeAccessTokenIssuer:
    def issue(self, user: User) -> str:
        return f"access:{user.id}"

    def decode(self, token: str) -> UUID:
        return UUID(token.split(":", 1)[1])


@dataclass
class FakeRefreshTokenIssuer:
    counter: int = 0
    raw_by_hash: dict[str, str] = field(default_factory=dict)

    def issue(self) -> tuple[str, str]:
        self.counter += 1
        raw = f"refresh:{self.counter}"
        hashed = self.hash(raw)
        self.raw_by_hash[hashed] = raw
        return raw, hashed

    def hash(self, raw: str) -> str:
        return f"sha:{raw}"


@dataclass
class FakeAuditSink:
    records: list[dict[str, Any]] = field(default_factory=list)

    async def record(
        self,
        action: str,
        entity_type: str,
        entity_id: str | None,
        actor_id: UUID | None,
        metadata: dict[str, Any] | None,
        ip: str | None,
    ) -> None:
        self.records.append(
            {
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "actor_id": actor_id,
                "metadata": metadata or {},
                "ip": ip,
            }
        )


@dataclass
class FakeUnitOfWork:
    commits: int = 0
    rollbacks: int = 0

    async def __aenter__(self) -> "FakeUnitOfWork":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if exc_type is None:
            self.commits += 1
        else:
            self.rollbacks += 1


@dataclass
class FakeConversationRepository:
    conversations: list[Conversation] = field(default_factory=list)
    members: list[ConversationMember] = field(default_factory=list)

    async def add(self, conversation: Conversation) -> None:
        self.conversations.append(conversation)

    async def get_by_id(self, conversation_id: UUID) -> Conversation | None:
        return next((c for c in self.conversations if c.id == conversation_id), None)

    async def get_channel_by_sector(self, sector_id: UUID) -> Conversation | None:
        return next((c for c in self.conversations if c.sector_id == sector_id), None)

    async def get_dm(self, user_a: UUID, user_b: UUID) -> Conversation | None:
        return next(
            (c for c in self.conversations if c.kind == "dm" and c.dm_key == _key(user_a, user_b)),
            None,
        )

    async def list_for_user(self, user_id: UUID) -> list[Conversation]:
        return [
            c
            for c in self.conversations
            if any(
                m.conversation_id == c.id and m.user_id == user_id and m.left_at is None
                for m in self.members
            )
        ]

    async def add_member(self, member: ConversationMember) -> None:
        self.members.append(member)

    async def update_member(self, member: ConversationMember) -> None:
        self.members = [
            member
            if m.user_id == member.user_id and m.conversation_id == member.conversation_id
            else m
            for m in self.members
        ]

    async def get_member(self, conversation_id: UUID, user_id: UUID) -> ConversationMember | None:
        return next(
            (
                m
                for m in self.members
                if m.conversation_id == conversation_id and m.user_id == user_id
            ),
            None,
        )

    async def list_members(self, conversation_id: UUID) -> list[ConversationMember]:
        return [m for m in self.members if m.conversation_id == conversation_id]


def _key(user_a: UUID, user_b: UUID) -> str:
    ordered = sorted((str(user_a), str(user_b)))
    return f"{ordered[0]}:{ordered[1]}"


@dataclass
class FakeMessageRepository:
    messages: list[Message] = field(default_factory=list)
    counter: int = 0

    async def add(self, message: Message) -> Message:
        self.counter += 1
        persisted = message.with_seq(self.counter)
        self.messages.append(persisted)
        return persisted

    async def update(self, message: Message) -> None:
        self.messages = [message if m.id == message.id else m for m in self.messages]

    async def get_by_id(self, message_id: UUID) -> Message | None:
        return next((m for m in self.messages if m.id == message_id), None)

    async def get_by_client_id(self, conversation_id: UUID, client_id: str) -> Message | None:
        return next(
            (
                m
                for m in self.messages
                if m.conversation_id == conversation_id and m.client_id == client_id
            ),
            None,
        )

    async def page(
        self, conversation_id: UUID, before_seq: int | None, after_seq: int | None, limit: int
    ) -> list[Message]:
        result = [m for m in self.messages if m.conversation_id == conversation_id]
        if before_seq is not None:
            result = [m for m in result if m.seq < before_seq]
        if after_seq is not None:
            result = [m for m in result if m.seq > after_seq]
        return sorted(result, key=lambda m: m.seq)[:limit]

    async def last(self, conversation_id: UUID) -> Message | None:
        result = [m for m in self.messages if m.conversation_id == conversation_id]
        return max(result, key=lambda m: m.seq) if result else None

    async def unread_count(self, conversation_id: UUID, last_read_seq: int) -> int:
        return len(
            [
                m
                for m in self.messages
                if m.conversation_id == conversation_id and m.seq > last_read_seq
            ]
        )


@dataclass
class FakeMessageReadRepository:
    reads: dict[tuple[UUID, UUID], int] = field(default_factory=dict)

    async def upsert(self, conversation_id: UUID, user_id: UUID, last_read_seq: int) -> None:
        self.reads[(conversation_id, user_id)] = last_read_seq

    async def get(self, conversation_id: UUID, user_id: UUID) -> int:
        return self.reads.get((conversation_id, user_id), 0)


@dataclass
class FakeEventBus:
    events: list[object] = field(default_factory=list)

    async def publish(self, event: object) -> None:
        self.events.append(event)


@dataclass
class FakeAttachmentRepository:
    attachments: list[Attachment] = field(default_factory=list)

    async def add(self, attachment: Attachment) -> None:
        self.attachments.append(attachment)

    async def update(self, attachment: Attachment) -> None:
        self.attachments = [attachment if a.id == attachment.id else a for a in self.attachments]

    async def get_by_id(self, attachment_id: UUID) -> Attachment | None:
        return next((a for a in self.attachments if a.id == attachment_id), None)

    async def get_by_sha256(self, sha256: str) -> Attachment | None:
        return next((a for a in self.attachments if a.sha256 == sha256), None)

    async def list_orphans_older_than(self, before) -> list[Attachment]:
        return [a for a in self.attachments if a.message_id is None and a.created_at < before]

    async def delete(self, attachment: Attachment) -> None:
        self.attachments = [a for a in self.attachments if a.id != attachment.id]
