from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID, uuid4


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

    @classmethod
    def create(
        cls,
        uploader_id: UUID,
        filename: str,
        mime_type: str,
        size_bytes: int,
        sha256: str,
        storage_path: str,
        now: datetime,
    ) -> "Attachment":
        return cls(
            id=uuid4(),
            message_id=None,
            uploader_id=uploader_id,
            filename=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            sha256=sha256,
            storage_path=storage_path,
            created_at=now,
        )

    def link(self, message_id: UUID) -> "Attachment":
        return replace(self, message_id=message_id)
