import hashlib
from datetime import UTC, datetime

import pytest
from app.application.use_cases.messages import SendMessage, SendMessageCommand
from app.application.use_cases.upload_file import UploadFile, UploadFileCommand
from app.domain.entities.attachment import Attachment
from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.entities.user import User, Username
from app.domain.exceptions import ValidationError
from app.domain.policies.conversation_access import ConversationAccessPolicy
from app.infrastructure.storage import LocalDiskStorage

from tests.unit.fakes import (
    FakeAttachmentRepository,
    FakeConversationRepository,
    FakeEventBus,
    FakeHasher,
    FakeMessageRepository,
    FakeUnitOfWork,
    FixedClock,
)

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
CONTENT = b"conteudo-de-teste"


async def _content() -> object:
    yield CONTENT


def make_user(username: str) -> User:
    return User.create(
        Username(username), username, "member", None, FakeHasher().hash("x" * 10), NOW
    )


def make_attachment(uploader: User, sha256: str) -> Attachment:
    return Attachment.create(
        uploader_id=uploader.id,
        filename="doc.pdf",
        mime_type="application/pdf",
        size_bytes=len(CONTENT),
        sha256=sha256,
        storage_path=f"files/{sha256}",
        now=NOW,
    )


async def test_upload_stores_file(tmp_path) -> None:
    attachments = FakeAttachmentRepository()
    storage = LocalDiskStorage(tmp_path)
    use_case = UploadFile(attachments, storage, FakeUnitOfWork(), FixedClock(NOW))

    attachment = await use_case.execute(
        UploadFileCommand(
            uploader_id=make_user("ana.souza").id,
            filename="documento.pdf",
            content=_content(),
            max_size_bytes=1024 * 1024,
        )
    )

    assert attachment.sha256 == hashlib.sha256(CONTENT).hexdigest()
    assert attachment.size_bytes == len(CONTENT)
    assert storage.resolve(attachment.storage_path).read_bytes() == CONTENT


async def test_upload_deduplicates_by_sha256(tmp_path) -> None:
    attachments = FakeAttachmentRepository()
    storage = LocalDiskStorage(tmp_path)
    use_case = UploadFile(attachments, storage, FakeUnitOfWork(), FixedClock(NOW))
    uploader = make_user("ana.souza")

    first = await use_case.execute(
        UploadFileCommand(
            uploader_id=uploader.id,
            filename="a.pdf",
            content=_content(),
            max_size_bytes=1024 * 1024,
        )
    )
    second = await use_case.execute(
        UploadFileCommand(
            uploader_id=uploader.id,
            filename="b.pdf",
            content=_content(),
            max_size_bytes=1024 * 1024,
        )
    )

    assert first.id == second.id
    assert len(attachments.attachments) == 1


async def test_upload_blocks_dangerous_extension(tmp_path) -> None:
    use_case = UploadFile(
        FakeAttachmentRepository(), LocalDiskStorage(tmp_path), FakeUnitOfWork(), FixedClock(NOW)
    )

    with pytest.raises(ValidationError):
        await use_case.execute(
            UploadFileCommand(
                uploader_id=make_user("ana.souza").id,
                filename="setup.exe",
                content=_content(),
                max_size_bytes=1024 * 1024,
            )
        )


async def test_send_message_links_attachment() -> None:
    a = make_user("ana.souza")
    b = make_user("bruno.lima")
    conversation = Conversation.create_dm(a.id, b.id, NOW)
    conversations = FakeConversationRepository(
        conversations=[conversation],
        members=[
            ConversationMember.create(conversation.id, a.id, NOW),
            ConversationMember.create(conversation.id, b.id, NOW),
        ],
    )
    messages = FakeMessageRepository()
    attachments = FakeAttachmentRepository(attachments=[make_attachment(a, "a" * 64)])
    events = FakeEventBus()
    use_case = SendMessage(
        conversations,
        messages,
        attachments,
        ConversationAccessPolicy(),
        events,
        FakeUnitOfWork(),
        FixedClock(NOW),
    )

    message = await use_case.execute(
        SendMessageCommand(
            conversation_id=conversation.id,
            sender_id=a.id,
            client_id="c1",
            body="Segue o anexo",
            attachment_ids=frozenset({attachments.attachments[0].id}),
        )
    )

    assert message.seq == 1
    assert attachments.attachments[0].message_id == message.id
