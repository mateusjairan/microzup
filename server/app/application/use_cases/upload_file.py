import hashlib
from pathlib import Path
from uuid import uuid4

import aiofiles

from app.application.dto import UploadFileCommand
from app.application.events import AttachmentReady
from app.domain.entities.attachment import Attachment
from app.domain.exceptions import ValidationError
from app.domain.ports.clock import Clock
from app.domain.ports.events import EventBus
from app.domain.ports.repositories import AttachmentRepository
from app.domain.ports.storage import FileStorage, MimeSniffer, Thumbnailer
from app.domain.ports.unit_of_work import UnitOfWork
from app.domain.value_objects.file_name import FileName
from app.domain.value_objects.file_size import FileSize
from app.domain.value_objects.sha256 import Sha256

__all__ = ["UploadFile", "UploadFileCommand"]

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
# MIME de conteúdo executável detectado por magic bytes, mesmo com nome inofensivo.
BLOCKED_MIME_TYPES = {
    "application/x-dosexec",
    "application/x-msdownload",
    "application/x-msdos-program",
    "application/x-executable",
    "application/x-sharedlib",
    "application/x-mach-binary",
    "application/vnd.microsoft.portable-executable",
}
THUMBNAIL_MAX_EDGE = 480  # plano-frontend §8.6
_SNIFF_HEAD_BYTES = 2048


def _extract_extension(filename: str) -> str:
    return Path(filename).suffix.lower()


def _guess_mime_by_extension(filename: str) -> str:
    import mimetypes

    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def _effective_mime(sniffed: str, filename: str) -> str:
    # Magic bytes mandam; a extensão só entra quando o conteúdo é genérico demais.
    if sniffed in ("", "application/octet-stream"):
        return _guess_mime_by_extension(filename)
    return sniffed


class UploadFile:
    def __init__(
        self,
        attachments: AttachmentRepository,
        storage: FileStorage,
        uow: UnitOfWork,
        clock: Clock,
        sniffer: MimeSniffer,
        thumbnailer: Thumbnailer,
        events: EventBus,
    ) -> None:
        self._attachments = attachments
        self._storage = storage
        self._uow = uow
        self._clock = clock
        self._sniffer = sniffer
        self._thumbnailer = thumbnailer
        self._events = events

    async def execute(self, command: UploadFileCommand) -> Attachment:
        filename = Path(command.filename).name  # remove componentes de diretório
        if not filename:
            raise ValidationError("Nome de arquivo inválido.")
        if _extract_extension(filename) in BLOCKED_EXTENSIONS:
            raise ValidationError("Este tipo de arquivo não é permitido.")

        now = self._clock.now()
        storage_path = f"files/{now:%Y/%m}/{uuid4()}"

        digest = hashlib.sha256()
        size = 0
        head = b""
        destination = self._storage.resolve(storage_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(destination, "wb") as handle:
            async for chunk in command.content:
                if not head:
                    head = chunk[:_SNIFF_HEAD_BYTES]
                digest.update(chunk)
                size += len(chunk)
                if size > command.max_size_bytes:
                    await handle.close()
                    self._storage.delete(storage_path)
                    raise ValidationError(
                        f"Arquivo excede o limite de {command.max_size_bytes // (1024 * 1024)} MB."
                    )
                await handle.write(chunk)

        mime_type = _effective_mime(self._sniffer.sniff(head), filename)
        if mime_type in BLOCKED_MIME_TYPES:
            # Conteúdo executável disfarçado: magic bytes não mentem.
            self._storage.delete(storage_path)
            raise ValidationError("O conteúdo deste arquivo não é permitido.")

        thumbnail_path: str | None = None
        if mime_type.startswith("image/"):
            thumb_relative = f"thumbs/{now:%Y/%m}/{destination.name}.jpg"
            generated = await self._thumbnailer.make(
                source=destination,
                destination=self._storage.resolve(thumb_relative),
                max_edge=THUMBNAIL_MAX_EDGE,
            )
            if generated is not None:
                thumbnail_path = thumb_relative

        sha256 = digest.hexdigest()

        existing = await self._attachments.get_by_sha256(sha256)
        if existing is not None:
            # Deduplicação: reaproveita o blob existente e descarta o temporário.
            self._storage.delete(storage_path)
            if existing.thumbnail_path is None and thumbnail_path is not None:
                # Blob antigo ganha a prévia que ainda não tinha.
                existing = existing.with_thumbnail(thumbnail_path)
                async with self._uow:
                    await self._attachments.update(existing)
            await self._events.publish(AttachmentReady(existing, frozenset({command.uploader_id})))
            return existing

        attachment = Attachment.create(
            uploader_id=command.uploader_id,
            filename=FileName(filename),
            mime_type=mime_type,
            size_bytes=FileSize(size),
            sha256=Sha256(sha256),
            storage_path=storage_path,
            now=now,
            thumbnail_path=thumbnail_path,
        )

        async with self._uow:
            await self._attachments.add(attachment)

        await self._events.publish(AttachmentReady(attachment, frozenset({command.uploader_id})))
        return attachment
