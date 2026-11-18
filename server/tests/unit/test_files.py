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
from app.domain.value_objects.file_name import FileName
from app.domain.value_objects.file_size import FileSize
from app.domain.value_objects.sha256 import Sha256
from app.infrastructure.events import NullEventBus
from app.infrastructure.media import LibmagicMimeSniffer, PillowImageThumbnailer
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

PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT\x08\xd7c\xf8\xcf\xc0\xf0\x1f\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)
MZ_BYTES = (
    b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00\xb8\x00\x00\x00"
    b"\x00\x00\x00\x00@\x00\x00\x00\x00\x00\x00\x00"
)


def make_user(username: str) -> User:
    return User.create(
        Username(username), username, "member", None, FakeHasher().hash("x" * 10), NOW
    )


def make_attachment(uploader: User, sha256: str) -> Attachment:
    return Attachment.create(
        uploader_id=uploader.id,
        filename=FileName("doc.pdf"),
        mime_type="application/pdf",
        size_bytes=FileSize(len(CONTENT)),
        sha256=Sha256(sha256),
        storage_path=f"files/{sha256}",
        now=NOW,
    )


def make_upload_use_case(tmp_path, sniffer=None, thumbnailer=None, events=None):
    return UploadFile(
        FakeAttachmentRepository(),
        LocalDiskStorage(tmp_path),
        FakeUnitOfWork(),
        FixedClock(NOW),
        sniffer if sniffer is not None else LibmagicMimeSniffer(),
        thumbnailer if thumbnailer is not None else PillowImageThumbnailer(),
        events if events is not None else FakeEventBus(),
    )


async def _content(data: bytes = CONTENT) -> object:
    yield data


async def test_upload_stores_file(tmp_path) -> None:
    use_case = make_upload_use_case(tmp_path)
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
    assert storage_of(tmp_path).resolve(attachment.storage_path).read_bytes() == CONTENT


def storage_of(tmp_path) -> LocalDiskStorage:
    return LocalDiskStorage(tmp_path)


async def test_upload_sniffs_real_mime_from_magic_bytes(tmp_path) -> None:
    """Prova do MIME real: magic bytes de PNG valem mais que a extensão."""
    use_case = make_upload_use_case(tmp_path)
    attachment = await use_case.execute(
        UploadFileCommand(
            uploader_id=make_user("ana.souza").id,
            filename="foto.png",
            content=_content(PNG_BYTES),
            max_size_bytes=1024 * 1024,
        )
    )
    assert attachment.mime_type == "image/png"

    # TXT renomeado para .pdf continua sendo text/plain no banco.
    text_attachment = await use_case.execute(
        UploadFileCommand(
            uploader_id=make_user("ana.souza").id,
            filename="relatorio.pdf",
            content=_content(b"isto nao e um pdf, e texto comum\n"),
            max_size_bytes=1024 * 1024,
        )
    )
    assert text_attachment.mime_type == "text/plain"


async def test_upload_blocks_executable_content_disguised_as_pdf(tmp_path) -> None:
    """Magic bytes MZ (PE/EXE) rejeitados mesmo com nome inofensivo .pdf."""
    use_case = make_upload_use_case(tmp_path)

    with pytest.raises(ValidationError, match="conteúdo"):
        await use_case.execute(
            UploadFileCommand(
                uploader_id=make_user("ana.souza").id,
                filename="relatorio.pdf",
                content=_content(MZ_BYTES),
                max_size_bytes=1024 * 1024,
            )
        )


async def test_upload_deduplicates_by_sha256(tmp_path) -> None:
    attachments = FakeAttachmentRepository()
    use_case = UploadFile(
        attachments,
        LocalDiskStorage(tmp_path),
        FakeUnitOfWork(),
        FixedClock(NOW),
        LibmagicMimeSniffer(),
        PillowImageThumbnailer(),
        FakeEventBus(),
    )
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
    use_case = make_upload_use_case(tmp_path)

    with pytest.raises(ValidationError):
        await use_case.execute(
            UploadFileCommand(
                uploader_id=make_user("ana.souza").id,
                filename="setup.exe",
                content=_content(),
                max_size_bytes=1024 * 1024,
            )
        )


async def test_upload_generates_480px_thumbnail_and_publishes_ready(tmp_path) -> None:
    events = FakeEventBus()
    use_case = make_upload_use_case(tmp_path, events=events)

    attachment = await use_case.execute(
        UploadFileCommand(
            uploader_id=make_user("ana.souza").id,
            filename="grafico.png",
            content=_content(PNG_BYTES),
            max_size_bytes=1024 * 1024,
        )
    )

    assert attachment.thumbnail_path is not None
    thumb = storage_of(tmp_path).resolve(attachment.thumbnail_path)
    assert thumb.exists()
    assert thumb.read_bytes()[:3] == b"\xff\xd8\xff"  # JPEG

    from PIL import Image

    with Image.open(thumb) as preview:
        assert max(preview.size) <= 480

    from app.application.events import AttachmentReady

    ready = [e for e in events.events if isinstance(e, AttachmentReady)]
    assert len(ready) == 1
    assert ready[0].attachment.id == attachment.id
    assert ready[0].recipient_ids == frozenset({attachment.uploader_id})


async def test_upload_non_image_has_no_thumbnail(tmp_path) -> None:
    events = FakeEventBus()
    use_case = make_upload_use_case(tmp_path, events=events)

    attachment = await use_case.execute(
        UploadFileCommand(
            uploader_id=make_user("ana.souza").id,
            filename="nota.txt",
            content=_content(b"apenas texto"),
            max_size_bytes=1024 * 1024,
        )
    )

    assert attachment.mime_type == "text/plain"
    assert attachment.thumbnail_path is None
    from app.application.events import AttachmentReady

    assert [e for e in events.events if isinstance(e, AttachmentReady)][
        0
    ].attachment.thumbnail_path is None


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
    use_case = SendMessage(
        conversations,
        messages,
        attachments,
        ConversationAccessPolicy(),
        NullEventBus(),
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


def test_pillow_thumbnailer_scales_longest_edge(tmp_path) -> None:
    from PIL import Image

    source = tmp_path / "big.png"
    Image.new("RGB", (1920, 1080), "blue").save(source, format="PNG")

    thumbnailer = PillowImageThumbnailer()
    destination = tmp_path / "out.jpg"

    import asyncio

    made = asyncio.run(thumbnailer.make(source, destination, 480))

    assert made == destination
    with Image.open(destination) as preview:
        assert max(preview.size) == 480


def test_libmagic_sniffer_detects_png_and_dosexec() -> None:
    sniffer = LibmagicMimeSniffer()
    assert sniffer.sniff(PNG_BYTES) == "image/png"
    assert sniffer.sniff(MZ_BYTES) == "application/x-dosexec"
    assert sniffer.sniff(b"") in ("application/octet-stream", "application/x-empty")
