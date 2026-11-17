from collections.abc import AsyncIterable
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid4

import aiofiles

from app.domain.entities.attachment import Attachment
from app.domain.exceptions import ValidationError
from app.domain.ports.clock import Clock
from app.domain.ports.repositories import AttachmentRepository
from app.domain.ports.storage import FileStorage
from app.domain.ports.unit_of_work import UnitOfWork

BLOCKED_EXTENSIONS = {
    ".exe",
    ".bat",
    ".cmd",
    ".ps1",
    ".scr",
    ".msi",
    ".com",
    ".vbs",
    ".js",
    ".jar",
    ".dll",
    ".reg",
    ".hta",
}


@dataclass(frozen=True, slots=True)
class UploadFileCommand:
    uploader_id: UUID
    filename: str
    content: AsyncIterable[bytes]
    max_size_bytes: int


def _extract_extension(filename: str) -> str:
    return Path(filename).suffix.lower()


class UploadFile:
    def __init__(
        self,
        attachments: AttachmentRepository,
        storage: FileStorage,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._attachments = attachments
        self._storage = storage
        self._uow = uow
        self._clock = clock

    async def execute(self, command: UploadFileCommand) -> Attachment:
        filename = Path(command.filename).name  # remove componentes de diretório
        if _extract_extension(filename) in BLOCKED_EXTENSIONS:
            raise ValidationError("Este tipo de arquivo não é permitido.")

        if not filename:
            raise ValidationError("Nome de arquivo inválido.")

        now = self._clock.now()
        storage_path = f"files/{now:%Y/%m}/{uuid4()}"

        import hashlib

        digest = hashlib.sha256()
        size = 0
        destination = self._storage.resolve(storage_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(destination, "wb") as handle:
            async for chunk in command.content:
                digest.update(chunk)
                size += len(chunk)
                if size > command.max_size_bytes:
                    await handle.close()
                    self._storage.delete(storage_path)
                    raise ValidationError(
                        f"Arquivo excede o limite de {command.max_size_bytes // (1024 * 1024)} MB."
                    )
                await handle.write(chunk)

        sha256 = digest.hexdigest()

        existing = await self._attachments.get_by_sha256(sha256)
        if existing is not None:
            # Deduplicação: reaproveita o blob existente e descarta o temporário.
            self._storage.delete(storage_path)
            return existing

        attachment = Attachment.create(
            uploader_id=command.uploader_id,
            filename=filename,
            mime_type=_guess_mime(filename),
            size_bytes=size,
            sha256=sha256,
            storage_path=storage_path,
            now=now,
        )

        async with self._uow:
            await self._attachments.add(attachment)

        return attachment


def _guess_mime(filename: str) -> str:
    import mimetypes

    return mimetypes.guess_type(filename)[0] or "application/octet-stream"
