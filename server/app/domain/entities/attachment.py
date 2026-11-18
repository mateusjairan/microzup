from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID, uuid4

from app.domain.value_objects.file_name import FileName
from app.domain.value_objects.file_size import FileSize
from app.domain.value_objects.sha256 import Sha256


@dataclass(frozen=True, slots=True)
class Attachment:
    id: UUID
    message_id: UUID | None
    uploader_id: UUID
    filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    storage_path: str
    created_at: datetime
    thumbnail_path: str | None = None

    @classmethod
    def create(
        cls,
        uploader_id: UUID,
        filename: FileName,
        mime_type: str,
        size_bytes: FileSize,
        sha256: Sha256,
        storage_path: str,
        now: datetime,
        thumbnail_path: str | None = None,
    ) -> "Attachment":
        return cls(
            id=uuid4(),
            message_id=None,
            uploader_id=uploader_id,
            filename=filename.value,
            mime_type=mime_type,
            size_bytes=size_bytes.value,
            sha256=sha256.value,
            storage_path=storage_path,
            created_at=now,
            thumbnail_path=thumbnail_path,
        )

    def link(self, message_id: UUID) -> "Attachment":
        return replace(self, message_id=message_id)

    def with_thumbnail(self, thumbnail_path: str | None) -> "Attachment":
        return replace(self, thumbnail_path=thumbnail_path)


@dataclass(frozen=True, slots=True)
class AttachmentHit:
    """Anexo encontrado na busca por nome de arquivo, com o contexto da mensagem.

    O índice trigram devolve o anexo; a UI precisa saber em que conversa e em
    que posição (`seq`) ele vive para poder saltar até a mensagem.
    """

    attachment: Attachment
    conversation_id: UUID
    message_seq: int
    message_created_at: datetime
