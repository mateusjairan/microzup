from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Request, UploadFile, status
from fastapi.responses import FileResponse

from app.application.use_cases.download_file import DownloadFileCommand
from app.application.use_cases.upload_file import UploadFileCommand
from app.domain.exceptions import NotFoundError
from app.domain.policies.conversation_access import ConversationAccessPolicy
from app.infrastructure.db.repositories.attachments import SqlAlchemyAttachmentRepository
from app.infrastructure.db.repositories.conversations import SqlAlchemyConversationRepository
from app.infrastructure.db.repositories.messages import SqlAlchemyMessageRepository
from app.presentation.api.schemas import AttachmentOut
from app.presentation.deps import (
    CurrentUserDep,
    DownloadFileDep,
    SessionDep,
    UploadFileDep,
)

router = APIRouter(tags=["files"])

_CHUNK = 1024 * 1024


async def _chunks(file: UploadFile) -> AsyncIterator[bytes]:
    while True:
        chunk = await file.read(_CHUNK)
        if not chunk:
            break
        yield chunk


@router.post("/files", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile, request: Request, current: CurrentUserDep, use_case: UploadFileDep
) -> AttachmentOut:
    max_size_bytes = request.app.state.settings.max_upload_mb * 1024 * 1024
    attachment = await use_case.execute(
        UploadFileCommand(
            uploader_id=current.id,
            filename=file.filename or "arquivo",
            content=_chunks(file),
            max_size_bytes=max_size_bytes,
        )
    )
    return AttachmentOut.from_attachment(attachment)


@router.get("/files/{attachment_id}")
async def download_file(
    attachment_id: UUID, current: CurrentUserDep, use_case: DownloadFileDep
) -> FileResponse:
    attachment, path = await use_case.execute(
        DownloadFileCommand(attachment_id=attachment_id, actor_id=current.id)
    )
    return FileResponse(
        path=path,
        filename=attachment.filename,
        media_type="application/octet-stream",
        content_disposition_type="attachment",
    )


@router.get("/messages/{message_id}/attachments", response_model=list[AttachmentOut])
async def list_message_attachments(
    message_id: UUID, current: CurrentUserDep, session: SessionDep
) -> list[AttachmentOut]:
    messages = SqlAlchemyMessageRepository(session)
    message = await messages.get_by_id(message_id)
    if message is None:
        raise NotFoundError("Mensagem não encontrada.")

    conversations = SqlAlchemyConversationRepository(session)
    member = await conversations.get_member(message.conversation_id, current.id)
    ConversationAccessPolicy().ensure_can_read(member)

    attachments = await SqlAlchemyAttachmentRepository(session).list_by_message(message_id)
    return [AttachmentOut.from_attachment(a) for a in attachments]
