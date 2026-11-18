from pathlib import Path

from app.application.dto import DownloadFileCommand
from app.application.events import AuditRequested
from app.domain.entities.attachment import Attachment
from app.domain.exceptions import NotFoundError
from app.domain.policies.conversation_access import ConversationAccessPolicy
from app.domain.ports.events import EventBus
from app.domain.ports.repositories import (
    AttachmentRepository,
    ConversationRepository,
    MessageRepository,
)
from app.domain.ports.storage import FileStorage

__all__ = ["DownloadFile", "DownloadFileCommand"]


class DownloadFile:
    def __init__(
        self,
        attachments: AttachmentRepository,
        messages: MessageRepository,
        conversations: ConversationRepository,
        policy: ConversationAccessPolicy,
        storage: FileStorage,
        events: EventBus,
    ) -> None:
        self._attachments = attachments
        self._messages = messages
        self._conversations = conversations
        self._policy = policy
        self._storage = storage
        self._events = events

    async def execute(self, command: DownloadFileCommand) -> tuple[Attachment, Path]:
        missing = NotFoundError("Arquivo não encontrado.")
        attachment = await self._attachments.get_or_raise(command.attachment_id, missing)
        if attachment.message_id is None:
            raise missing

        message = await self._messages.get_or_raise(attachment.message_id, missing)

        member = await self._conversations.get_member(message.conversation_id, command.actor_id)
        self._policy.ensure_can_read(member)

        if command.thumbnail:
            # Prévia inline da conversa (não é um download de arquivo para auditoria;
            # a autorização por membro continua sendo revalidada acima).
            if attachment.thumbnail_path is None:
                raise NotFoundError("Prévia não disponível para este arquivo.")
            return attachment, self._storage.resolve(attachment.thumbnail_path)

        await self._events.publish(
            AuditRequested(
                action="file.download",
                entity_type="attachment",
                entity_id=str(attachment.id),
                actor_id=command.actor_id,
                metadata={
                    "filename": attachment.filename,
                    "sha256": attachment.sha256,
                    "conversation_id": str(message.conversation_id),
                },
                ip=command.ip,
            )
        )

        return attachment, self._storage.resolve(attachment.storage_path)
