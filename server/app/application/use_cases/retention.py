"""Executa a retenção opcional de mensagens e arquivos (plano §8).

Regras de integridade:
- Mensagens NUNCA têm DELETE físico — retenção = soft delete (`deleted_at`,
  corpo substituído) com o original preservado na auditoria (`message.purge`).
- Anexos podem ser removidos do disco e da tabela (`file.purge` auditado);
  não há regra de soft delete para `attachments`.
- O ator é o sistema: `actor_id=None` no evento, marcado como `"system"` no
  metadata — rastreável pela ação `*.purge`.

Uma transação por execução (lote de até `batch_limit` itens de cada tipo);
o chamador (CLI `retention-run` / task do lifespan) repete até esgotar.
"""

from app.application.dto import RetentionRunCommand, RetentionRunResult
from app.application.events import AuditRequested
from app.domain.policies.retention import RetentionPolicy
from app.domain.ports.clock import Clock
from app.domain.ports.events import EventBus
from app.domain.ports.repositories import AttachmentRepository, MessageRepository
from app.domain.ports.storage import FileStorage
from app.domain.ports.unit_of_work import UnitOfWork

__all__ = ["RunRetention", "RetentionRunCommand", "RetentionRunResult"]


class RunRetention:
    def __init__(
        self,
        messages: MessageRepository,
        attachments: AttachmentRepository,
        storage: FileStorage,
        policy: RetentionPolicy,
        events: EventBus,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._messages = messages
        self._attachments = attachments
        self._storage = storage
        self._policy = policy
        self._events = events
        self._uow = uow
        self._clock = clock

    async def execute(self, command: RetentionRunCommand) -> RetentionRunResult:
        now = self._clock.now()
        message_cutoff = self._policy.message_cutoff(now)
        file_cutoff = self._policy.file_cutoff(now)
        if message_cutoff is None and file_cutoff is None:
            return RetentionRunResult(messages_purged=0, files_purged=0)

        expired_messages = (
            await self._messages.list_expired(message_cutoff, command.batch_limit)
            if message_cutoff is not None
            else []
        )
        expired_files = (
            await self._attachments.list_expired(file_cutoff, command.batch_limit)
            if file_cutoff is not None
            else []
        )

        audit_events: list[AuditRequested] = []
        async with self._uow:
            for message in expired_messages:
                original_body = message.body
                # Ator sistema: deleted_by=NULL; a auditoria marca "system".
                deleted = message.delete(None, now)
                await self._messages.update(deleted)
                audit_events.append(
                    AuditRequested(
                        action="message.purge",
                        entity_type="message",
                        entity_id=str(message.id),
                        actor_id=None,
                        metadata={
                            "actor": "system",
                            "retention_days": self._policy.message_retention_days,
                            "conversation_id": str(message.conversation_id),
                            "original_body": original_body,
                        },
                    )
                )

            for attachment in expired_files:
                self._storage.delete(attachment.storage_path)
                if attachment.thumbnail_path is not None:
                    self._storage.delete(attachment.thumbnail_path)
                await self._attachments.delete(attachment)
                metadata: dict[str, object] = {
                    "actor": "system",
                    "retention_days": self._policy.file_retention_days,
                    "filename": attachment.filename,
                    "sha256": attachment.sha256,
                    "size_bytes": attachment.size_bytes,
                }
                if attachment.message_id is not None:
                    metadata["message_id"] = str(attachment.message_id)
                audit_events.append(
                    AuditRequested(
                        action="file.purge",
                        entity_type="attachment",
                        entity_id=str(attachment.id),
                        actor_id=None,
                        metadata=metadata,
                    )
                )

        for event in audit_events:
            await self._events.publish(event)

        return RetentionRunResult(
            messages_purged=len(expired_messages),
            files_purged=len(expired_files),
        )
