from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from app.domain.entities.attachment import Attachment
from app.domain.exceptions import NotFoundError
from app.domain.policies.conversation_access import ConversationAccessPolicy
from app.domain.ports.repositories import (
    AttachmentRepository,
    ConversationRepository,
    MessageRepository,
)
from app.domain.ports.storage import FileStorage


@dataclass(frozen=True, slots=True)
class DownloadFileCommand:
    attachment_id: UUID
    actor_id: UUID


class DownloadFile:
    def __init__(
        self,
        attachments: AttachmentRepository,
        messages: MessageRepository,
        conversations: ConversationRepository,
        policy: ConversationAccessPolicy,
        storage: FileStorage,
    ) -> None:
        self._attachments = attachments
        self._messages = messages
        self._conversations = conversations
        self._policy = policy
        self._storage = storage

    async def execute(self, command: DownloadFileCommand) -> tuple[Attachment, Path]:
        attachment = await self._attachments.get_by_id(command.attachment_id)
        if attachment is None or attachment.message_id is None:
            raise NotFoundError("Arquivo não encontrado.")

        message = await self._messages.get_by_id(attachment.message_id)
        if message is None:
            raise NotFoundError("Arquivo não encontrado.")

        member = await self._conversations.get_member(message.conversation_id, command.actor_id)
        self._policy.ensure_can_read(member)

        return attachment, self._storage.resolve(attachment.storage_path)
