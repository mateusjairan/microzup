from uuid import UUID

from app.application.dto import (
    DeleteMessageCommand,
    EditMessageCommand,
    ListMessagesCommand,
    MarkReadCommand,
    SendMessageCommand,
)
from app.application.events import (
    AuditRequested,
    MessageCreated,
    MessageDeleted,
    MessageUpdated,
    ReadUpdated,
)
from app.domain.entities.message import BODY_MAX, Message
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
from app.domain.value_objects.message_body import MessageBody

# Comandos/resultados vivem em application/dto.py (plano §3); re-export
# explícito mantém os importadores históricos (`from use_cases.messages import ...`).
__all__ = [
    "DeleteMessage",
    "DeleteMessageCommand",
    "EditMessage",
    "EditMessageCommand",
    "ListMessages",
    "ListMessagesCommand",
    "MarkRead",
    "MarkReadCommand",
    "SendMessage",
    "SendMessageCommand",
]


async def _recipient_ids(
    conversations: ConversationRepository, conversation_id: UUID
) -> frozenset[UUID]:
    members = await conversations.list_members(conversation_id)
    return frozenset(m.user_id for m in members if m.left_at is None)


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
        max_chars: int = BODY_MAX,
        max_attachments: int = 5,
    ) -> None:
        self._conversations = conversations
        self._messages = messages
        self._attachments = attachments
        self._policy = policy
        self._events = events
        self._uow = uow
        self._clock = clock
        self._max_chars = max_chars
        self._max_attachments = max_attachments

    async def execute(self, command: SendMessageCommand) -> Message:
        conversation = await self._conversations.get_or_raise(
            command.conversation_id, NotFoundError("Conversa não encontrada.")
        )

        member = await self._conversations.get_member(command.conversation_id, command.sender_id)
        self._policy.ensure_can_write(member, conversation)

        if len(command.attachment_ids) > self._max_attachments:
            raise ValidationError(f"Máximo de {self._max_attachments} anexos por mensagem.")

        existing = await self._messages.get_by_client_id(command.conversation_id, command.client_id)
        if existing is not None:
            return existing  # idempotência: retry não duplica (nem reaudita)

        message = Message.create(
            conversation_id=command.conversation_id,
            sender_id=command.sender_id,
            client_id=command.client_id,
            body=MessageBody(command.body, self._max_chars),
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
        await self._events.publish(
            AuditRequested(
                action="message.send",
                entity_type="message",
                entity_id=str(persisted.id),
                actor_id=command.sender_id,
                metadata={
                    "conversation_id": str(command.conversation_id),
                    "client_id": command.client_id,
                    "attachment_ids": sorted(str(aid) for aid in linked_ids),
                },
            )
        )
        return persisted


class EditMessage:
    def __init__(
        self,
        conversations: ConversationRepository,
        messages: MessageRepository,
        events: EventBus,
        uow: UnitOfWork,
        clock: Clock,
        max_chars: int = BODY_MAX,
    ) -> None:
        self._conversations = conversations
        self._messages = messages
        self._events = events
        self._uow = uow
        self._clock = clock
        self._max_chars = max_chars

    async def execute(self, command: EditMessageCommand) -> Message:
        message = await self._messages.get_or_raise(
            command.message_id, NotFoundError("Mensagem não encontrada.")
        )
        if message.is_deleted:
            raise ValidationError("Não é possível editar uma mensagem removida.")
        if message.sender_id != command.actor_id:
            raise NotFoundError("Mensagem não encontrada.")

        # Plano §5: o corpo ORIGINAL fica preservado no metadata da auditoria.
        original_body = message.body
        updated = message.edit(MessageBody(command.body, self._max_chars), self._clock.now())
        async with self._uow:
            await self._messages.update(updated)

        recipients = await _recipient_ids(self._conversations, message.conversation_id)
        await self._events.publish(MessageUpdated(updated, recipients))
        await self._events.publish(
            AuditRequested(
                action="message.edit",
                entity_type="message",
                entity_id=str(message.id),
                actor_id=command.actor_id,
                metadata={
                    "conversation_id": str(message.conversation_id),
                    "original_body": original_body,
                },
            )
        )
        return updated


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
        message = await self._messages.get_or_raise(
            command.message_id, NotFoundError("Mensagem não encontrada.")
        )
        if message.is_deleted:
            raise NotFoundError("Mensagem não encontrada.")
        if message.sender_id != command.actor_id:
            raise NotFoundError("Mensagem não encontrada.")

        # Plano §5: corpo substituído no banco, original preservado na auditoria.
        original_body = message.body
        deleted = message.delete(command.actor_id, self._clock.now())
        async with self._uow:
            await self._messages.update(deleted)

        recipients = await _recipient_ids(self._conversations, message.conversation_id)
        await self._events.publish(MessageDeleted(message.conversation_id, message.id, recipients))
        await self._events.publish(
            AuditRequested(
                action="message.delete",
                entity_type="message",
                entity_id=str(message.id),
                actor_id=command.actor_id,
                metadata={
                    "conversation_id": str(message.conversation_id),
                    "original_body": original_body,
                },
            )
        )
        return deleted


class MarkRead:
    def __init__(
        self,
        conversations: ConversationRepository,
        reads: MessageReadRepository,
        policy: ConversationAccessPolicy,
        uow: UnitOfWork,
        events: EventBus,
    ) -> None:
        self._conversations = conversations
        self._reads = reads
        self._policy = policy
        self._uow = uow
        self._events = events

    async def execute(self, command: MarkReadCommand) -> None:
        member = await self._conversations.get_member(command.conversation_id, command.user_id)
        self._policy.ensure_can_read(member)
        async with self._uow:
            await self._reads.upsert(
                command.conversation_id, command.user_id, command.last_read_seq
            )

        recipients = await _recipient_ids(self._conversations, command.conversation_id)
        await self._events.publish(
            ReadUpdated(
                conversation_id=command.conversation_id,
                user_id=command.user_id,
                last_read_seq=command.last_read_seq,
                recipient_ids=recipients,
            )
        )


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
