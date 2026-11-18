from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from types import TracebackType
from typing import Any
from uuid import UUID

from app.application.events import AuditRequested
from app.domain.entities.attachment import Attachment, AttachmentHit
from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.entities.message import Message
from app.domain.entities.sector import Sector
from app.domain.entities.session import UserSession
from app.domain.entities.user import User
from app.domain.exceptions import DomainError


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

    async def update(self, sector: Sector) -> None:
        self.sectors = [sector if s.id == sector.id else s for s in self.sectors]

    async def get_by_id(self, sector_id: UUID) -> Sector | None:
        return next((s for s in self.sectors if s.id == sector_id), None)

    async def get_or_raise(self, sector_id: UUID, error: DomainError) -> Sector:
        found = await self.get_by_id(sector_id)
        if found is None:
            raise error
        return found

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

    async def get_or_raise(self, user_id: UUID, error: DomainError) -> User:
        found = await self.get_by_id(user_id)
        if found is None:
            raise error
        return found

    async def get_by_username(self, username: str) -> User | None:
        return next((u for u in self.users if u.username == username.lower()), None)

    async def list_active(self) -> list[User]:
        return [u for u in self.users if u.is_active]

    async def list_all(self) -> list[User]:
        return list(self.users)

    async def exists_active_admin(self) -> bool:
        return any(u.role == "admin" and u.is_active for u in self.users)


@dataclass
class FakeSessionRepository:
    sessions: list[UserSession] = field(default_factory=list)

    async def add(self, session: UserSession) -> None:
        self.sessions.append(session)

    async def update(self, session: UserSession) -> None:
        self.sessions = [session if s.id == session.id else s for s in self.sessions]

    async def get_by_refresh_hash(self, refresh_hash: str) -> UserSession | None:
        return next((s for s in self.sessions if s.refresh_token_hash == refresh_hash), None)

    async def list_active_by_user(self, user_id: UUID) -> list[UserSession]:
        return [s for s in self.sessions if s.user_id == user_id and s.revoked_at is None]


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

    async def update(self, conversation: Conversation) -> None:
        self.conversations = [
            conversation if c.id == conversation.id else c for c in self.conversations
        ]

    async def get_by_id(self, conversation_id: UUID) -> Conversation | None:
        return next((c for c in self.conversations if c.id == conversation_id), None)

    async def get_or_raise(self, conversation_id: UUID, error: DomainError) -> Conversation:
        found = await self.get_by_id(conversation_id)
        if found is None:
            raise error
        return found

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

    async def list_channels(self) -> list[Conversation]:
        return [c for c in self.conversations if c.kind == "channel"]

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

    async def get_or_raise(self, message_id: UUID, error: DomainError) -> Message:
        found = await self.get_by_id(message_id)
        if found is None:
            raise error
        return found

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

    async def search(
        self,
        user_id: UUID,
        query: str,
        conversation_id: UUID | None,
        limit: int,
    ) -> list[Message]:
        """Filtro de membros é responsabilidade do SQL real (integração);
        aqui basta o casamento de termos + filtro de conversa + não removidas."""

        def _matches(text: str) -> bool:
            terms = query.lower().split()
            return all(term in text.lower() for term in terms)

        result = [
            m
            for m in self.messages
            if m.deleted_at is None
            and (conversation_id is None or m.conversation_id == conversation_id)
            and _matches(m.body)
        ]
        return result[:limit]

    async def list_expired(self, before: datetime, limit: int) -> list[Message]:
        return [
            m
            for m in sorted(self.messages, key=lambda x: x.created_at)
            if m.deleted_at is None and m.created_at < before
        ][:limit]


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
    # (message_id -> (conversation_id, seq, created_at)) para montar hits de busca.
    message_context: dict[UUID, tuple[UUID, int, datetime]] = field(default_factory=dict)

    async def add(self, attachment: Attachment) -> None:
        self.attachments.append(attachment)

    async def update(self, attachment: Attachment) -> None:
        self.attachments = [attachment if a.id == attachment.id else a for a in self.attachments]

    async def get_by_id(self, attachment_id: UUID) -> Attachment | None:
        return next((a for a in self.attachments if a.id == attachment_id), None)

    async def get_or_raise(self, attachment_id: UUID, error: DomainError) -> Attachment:
        found = await self.get_by_id(attachment_id)
        if found is None:
            raise error
        return found

    async def get_by_sha256(self, sha256: str) -> Attachment | None:
        return next((a for a in self.attachments if a.sha256 == sha256), None)

    async def list_orphans_older_than(self, before) -> list[Attachment]:
        return [a for a in self.attachments if a.message_id is None and a.created_at < before]

    async def list_by_message(self, message_id: UUID) -> list[Attachment]:
        return [a for a in self.attachments if a.message_id == message_id]

    async def search_by_filename(
        self,
        user_id: UUID,
        query: str,
        conversation_id: UUID | None,
        limit: int,
    ) -> list[AttachmentHit]:
        def _matches(text: str) -> bool:
            terms = query.lower().split()
            return all(term in text.lower() for term in terms)

        hits: list[AttachmentHit] = []
        for attachment in self.attachments:
            if attachment.message_id is None or not _matches(attachment.filename):
                continue
            context = self.message_context.get(attachment.message_id)
            if context is None:
                continue
            found_conversation_id, seq, created_at = context
            if conversation_id is not None and found_conversation_id != conversation_id:
                continue
            hits.append(
                AttachmentHit(
                    attachment=attachment,
                    conversation_id=found_conversation_id,
                    message_seq=seq,
                    message_created_at=created_at,
                )
            )
        return hits[:limit]

    async def list_expired(self, before: datetime, limit: int) -> list[Attachment]:
        return [
            a for a in sorted(self.attachments, key=lambda x: x.created_at) if a.created_at < before
        ][:limit]

    async def delete(self, attachment: Attachment) -> None:
        self.attachments = [a for a in self.attachments if a.id != attachment.id]


def audit_events(bus: "FakeEventBus") -> list[AuditRequested]:
    """Eventos AuditRequested capturados — substitui o antigo FakeAuditSink."""
    return [event for event in bus.events if isinstance(event, AuditRequested)]


@dataclass
class FakeRateLimiter:
    """Janela deslizante falsa com relógio manual — para provar throttles em teste."""

    clock_ticks: list[float] = field(default_factory=lambda: [0.0])
    _calls: dict[str, list[float]] = field(default_factory=dict)

    def _now(self) -> float:
        return self.clock_ticks[-1]

    def advance(self, seconds: float) -> None:
        self.clock_ticks.append(self._now() + seconds)

    def allow(self, key: str, limit: int, window_seconds: float) -> bool:
        now = self._now()
        events = [t for t in self._calls.get(key, []) if t > now - window_seconds]
        if len(events) >= limit:
            self._calls[key] = events
            return False
        events.append(now)
        self._calls[key] = events
        return True


@dataclass
class FakePresenceDirectory:
    statuses: dict[UUID, str] = field(default_factory=dict)

    def status_of(self, user_id: UUID) -> str:
        # Contrato PresenceDirectory: status EFETIVO (invisible aparece offline).
        status = self.statuses.get(user_id, "offline")
        return "offline" if status == "invisible" else status


class FakeFileStorage:
    """Resolve caminhos relativos sem tocar em disco (casos de uso de download)."""

    def __init__(self) -> None:
        self.deleted: list[str] = []

    def resolve(self, storage_path: str) -> Path:
        return Path(storage_path)

    def delete(self, storage_path: str) -> None:
        self.deleted.append(storage_path)


class FakeMimeSniffer:
    """Devolve o MIME que o teste quiser simular (magic bytes "verificados" fora)."""

    def __init__(self, detected: str = "image/png") -> None:
        self.detected = detected
        self.seen_heads: list[bytes] = []

    def sniff(self, head: bytes) -> str:
        self.seen_heads.append(head)
        return self.detected


class FakeThumbnailer:
    """Gera um "thumbnail" de mentira gravando o destino — sem Pillow."""

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple[object, object, int]] = []

    def _make_sync(self, source, destination, max_edge: int):
        import pathlib

        self.calls.append((source, destination, max_edge))
        if self.fail or not pathlib.Path(source).exists():
            return None
        pathlib.Path(destination).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(destination).write_bytes(b"thumb")
        return pathlib.Path(destination)

    async def make(self, source, destination, max_edge: int):
        return self._make_sync(source, destination, max_edge)
