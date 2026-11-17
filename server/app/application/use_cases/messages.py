from dataclasses import dataclass
from uuid import UUID

from app.application.events import MessageCreated, MessageDeleted, MessageUpdated
from app.domain.entities.message import Message, MessageBody
from app.domain.exceptions import NotFoundError, ValidationError
from app.domain.policies.conversation_access import ConversationAccessPolicy
from app.domain.ports.clock import Clock
from app.domain.ports.events import EventBus
from app.domain.ports.repositories import (
    AttachmentRepository,
    ConversationRepository,
    MessageReadRepository,
    MessageRepository,
)
from app.domain.ports.unit_of_work import UnitOfWork


async def _recipient_ids(
    conversations: ConversationRepository, conversation_id: UUID
) -> frozenset[UUID]:
    members = await conversations.list_members(conversation_id)
    return frozenset(m.user_id for m in members if m.left_at is None)


@dataclass(frozen=True, slots=True)
class SendMessageCommand:
    conversation_id: UUID
    sender_id: UUID
    client_id: str
    body: str
    attachment_ids: frozenset[UUID] = frozenset()


class SendMessage:
    def __init__(
        self,
        conversations: ConversationRepository,
        messages: MessageRepository,
        attachments: AttachmentRepository,
        policy: ConversationAccessPolicy,
        events: EventBus,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._conversations = conversations
        self._messages = messages
        self._attachments = attachments
        self._policy = policy
        self._events = events
        self._uow = uow
        self._clock = clock

    async def execute(self, command: SendMessageCommand) -> Message:
        member = await self._conversations.get_member(command.conversation_id, command.sender_id)
        self._policy.ensure_can_write(member)

        existing = await self._messages.get_by_client_id(command.conversation_id, command.client_id)
        if existing is not None:
            return existing  # idempotência: retry não duplica

        message = Message.create(
            conversation_id=command.conversation_id,
            sender_id=command.sender_id,
            client_id=command.client_id,
            body=MessageBody(command.body),
            now=self._clock.now(),
        )

        linked_ids: set[UUID] = set()
        async with self._uow:
            persisted = await self._messages.add(message)
            for attachment_id in command.attachment_ids:
                attachment = await self._attachments.get_by_id(attachment_id)
                if attachment is None or attachment.message_id is not None:
                    continue
                if attachment.uploader_id != command.sender_id:
                    raise ValidationError("Anexo não pertence ao remetente.")
                await self._attachments.update(attachment.link(persisted.id))
                linked_ids.add(attachment_id)

        recipients = await _recipient_ids(self._conversations, command.conversation_id)
        await self._events.publish(MessageCreated(persisted, recipients, frozenset(linked_ids)))
        return persisted


@dataclass(frozen=True, slots=True)
class EditMessageCommand:
    message_id: UUID
    actor_id: UUID
    body: str


class EditMessage:
    def __init__(
        self,
        conversations: ConversationRepository,
        messages: MessageRepository,
        events: EventBus,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._conversations = conversations
        self._messages = messages
        self._events = events
        self._uow = uow
        self._clock = clock

    async def execute(self, command: EditMessageCommand) -> Message:
        message = await self._messages.get_by_id(command.message_id)
        if message is None:
            raise NotFoundError("Mensagem não encontrada.")
        if message.is_deleted:
            raise ValidationError("Não é possível editar uma mensagem removida.")
        if message.sender_id != command.actor_id:
            raise NotFoundError("Mensagem não encontrada.")

        updated = message.edit(MessageBody(command.body), self._clock.now())
        async with self._uow:
            await self._messages.update(updated)

        recipients = await _recipient_ids(self._conversations, message.conversation_id)
        await self._events.publish(MessageUpdated(updated, recipients))
        return updated


@dataclass(frozen=True, slots=True)
class DeleteMessageCommand:
    message_id: UUID
    actor_id: UUID


class DeleteMessage:
    def __init__(
        self,
        conversations: ConversationRepository,
        messages: MessageRepository,
        events: EventBus,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._conversations = conversations
        self._messages = messages
        self._events = events
        self._uow = uow
        self._clock = clock

    async def execute(self, command: DeleteMessageCommand) -> Message:
        message = await self._messages.get_by_id(command.message_id)
        if message is None or message.is_deleted:
            raise NotFoundError("Mensagem não encontrada.")
        if message.sender_id != command.actor_id:
            raise NotFoundError("Mensagem não encontrada.")

        deleted = message.delete(command.actor_id, self._clock.now())
        async with self._uow:
            await self._messages.update(deleted)

        recipients = await _recipient_ids(self._conversations, message.conversation_id)
        await self._events.publish(MessageDeleted(message.conversation_id, message.id, recipients))
        return deleted


@dataclass(frozen=True, slots=True)
class MarkReadCommand:
    conversation_id: UUID
    user_id: UUID
    last_read_seq: int


class MarkRead:
    def __init__(
        self,
        conversations: ConversationRepository,
        reads: MessageReadRepository,
        policy: ConversationAccessPolicy,
        uow: UnitOfWork,
    ) -> None:
        self._conversations = conversations
        self._reads = reads
        self._policy = policy
        self._uow = uow

    async def execute(self, command: MarkReadCommand) -> None:
        member = await self._conversations.get_member(command.conversation_id, command.user_id)
        self._policy.ensure_can_read(member)
        async with self._uow:
            await self._reads.upsert(
                command.conversation_id, command.user_id, command.last_read_seq
            )


@dataclass(frozen=True, slots=True)
class ListMessagesCommand:
    conversation_id: UUID
    user_id: UUID
    before_seq: int | None = None
    after_seq: int | None = None
    limit: int = 50


class ListMessages:
    def __init__(
        self,
        conversations: ConversationRepository,
        messages: MessageRepository,
        policy: ConversationAccessPolicy,
    ) -> None:
        self._conversations = conversations
        self._messages = messages
        self._policy = policy

    async def execute(self, command: ListMessagesCommand) -> list[Message]:
        member = await self._conversations.get_member(command.conversation_id, command.user_id)
        self._policy.ensure_can_read(member)
        return await self._messages.page(
            command.conversation_id,
            command.before_seq,
            command.after_seq,
            command.limit,
        )
