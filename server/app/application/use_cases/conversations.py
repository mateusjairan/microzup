from dataclasses import dataclass
from uuid import UUID

from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.entities.message import Message
from app.domain.exceptions import NotFoundError, ValidationError
from app.domain.ports.clock import Clock
from app.domain.ports.repositories import (
    ConversationRepository,
    MessageReadRepository,
    MessageRepository,
    UserRepository,
)
from app.domain.ports.unit_of_work import UnitOfWork


@dataclass(frozen=True, slots=True)
class OpenDirectMessageCommand:
    actor_id: UUID
    other_user_id: UUID


class OpenDirectMessage:
    def __init__(
        self,
        conversations: ConversationRepository,
        users: UserRepository,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._conversations = conversations
        self._users = users
        self._uow = uow
        self._clock = clock

    async def execute(self, command: OpenDirectMessageCommand) -> Conversation:
        if command.actor_id == command.other_user_id:
            raise ValidationError("Não é possível abrir uma conversa consigo mesmo.")

        if await self._users.get_by_id(command.other_user_id) is None:
            raise NotFoundError("Usuário não encontrado.")

        existing = await self._conversations.get_dm(command.actor_id, command.other_user_id)
        if existing is not None:
            return existing

        now = self._clock.now()
        conversation = Conversation.create_dm(command.actor_id, command.other_user_id, now)

        async with self._uow:
            await self._conversations.add(conversation)
            await self._conversations.add_member(
                ConversationMember.create(conversation.id, command.actor_id, now)
            )
            await self._conversations.add_member(
                ConversationMember.create(conversation.id, command.other_user_id, now)
            )

        return conversation


@dataclass(frozen=True, slots=True)
class ConversationSummary:
    conversation: Conversation
    unread_count: int
    last_message: Message | None


class ListConversations:
    def __init__(
        self,
        conversations: ConversationRepository,
        messages: MessageRepository,
        reads: MessageReadRepository,
    ) -> None:
        self._conversations = conversations
        self._messages = messages
        self._reads = reads

    async def execute(self, user_id: UUID) -> list[ConversationSummary]:
        conversations = await self._conversations.list_for_user(user_id)
        summaries: list[ConversationSummary] = []
        for conversation in conversations:
            last_read_seq = await self._reads.get(conversation.id, user_id)
            unread = await self._messages.unread_count(conversation.id, last_read_seq)
            last_message = await self._messages.last(conversation.id)
            summaries.append(
                ConversationSummary(
                    conversation=conversation,
                    unread_count=unread,
                    last_message=last_message,
                )
            )
        return summaries
