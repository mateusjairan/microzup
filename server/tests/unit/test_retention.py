"""RetentionPolicy + RunRetention (plano §8) — unit, sem banco, Clock fake.

Regras de integridade: mensagens NUNCA têm DELETE físico (soft delete com
corpo preservado na auditoria, ator sistema); anexos são removidos do disco
e da tabela com auditoria `file.purge`.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.application.use_cases.retention import RetentionRunCommand, RunRetention
from app.domain.entities.attachment import Attachment
from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.entities.message import Message
from app.domain.entities.user import User, Username
from app.domain.policies.retention import RetentionPolicy
from app.domain.value_objects.file_name import FileName
from app.domain.value_objects.file_size import FileSize
from app.domain.value_objects.message_body import MessageBody
from app.domain.value_objects.sha256 import Sha256

from tests.unit.fakes import (
    FakeAttachmentRepository,
    FakeConversationRepository,
    FakeEventBus,
    FakeFileStorage,
    FakeHasher,
    FakeMessageRepository,
    FakeUnitOfWork,
    FixedClock,
    audit_events,
)

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)
OLD = NOW - timedelta(days=45)
RECENT = NOW - timedelta(days=2)


def make_user(username: str) -> User:
    return User.create(
        Username(username), username, "member", None, FakeHasher().hash("x" * 10), OLD
    )


def make_message(sender_id, conversation_id, client_id, created_at) -> Message:
    return Message.create(
        conversation_id, sender_id, client_id, MessageBody("conteúdo original"), created_at
    )


def make_attachment(uploader_id, created_at, with_thumbnail: bool = True) -> Attachment:
    return Attachment.create(
        uploader_id=uploader_id,
        filename=FileName("laudo-velho.pdf"),
        mime_type="application/pdf",
        size_bytes=FileSize(1024),
        sha256=Sha256("e" * 64),
        storage_path="files/2026/11/velho",
        now=created_at,
        thumbnail_path="thumbs/2026/11/velho.jpg" if with_thumbnail else None,
    )


def build_stack():
    ana = make_user("ana.souza")
    conversation = Conversation.create_dm(ana.id, uuid4(), OLD)
    conversations = FakeConversationRepository(
        conversations=[conversation],
        members=[ConversationMember.create(conversation.id, ana.id, OLD)],
    )
    return ana, conversation, conversations


def test_retention_policy_cutoffs_respect_zero_as_disabled() -> None:
    disabled = RetentionPolicy(message_retention_days=0, file_retention_days=0)
    assert disabled.enabled is False
    assert disabled.message_cutoff(NOW) is None
    assert disabled.file_cutoff(NOW) is None

    enabled = RetentionPolicy(message_retention_days=30, file_retention_days=90)
    assert enabled.enabled is True
    assert enabled.message_cutoff(NOW) == NOW - timedelta(days=30)
    assert enabled.file_cutoff(NOW) == NOW - timedelta(days=90)


async def test_run_retention_disabled_is_a_no_op() -> None:
    ana, conversation, conversations = build_stack()
    messages = FakeMessageRepository()
    messages.messages.append(make_message(ana.id, conversation.id, "c1", OLD))
    attachments = FakeAttachmentRepository()
    attachments.attachments.append(make_attachment(ana.id, OLD))
    storage = FakeFileStorage()
    events = FakeEventBus()

    use_case = RunRetention(
        messages,
        attachments,
        storage,
        RetentionPolicy(),
        events,
        FakeUnitOfWork(),
        FixedClock(NOW),
    )
    result = await use_case.execute(RetentionRunCommand())

    assert result.messages_purged == 0
    assert result.files_purged == 0
    assert messages.messages[0].deleted_at is None
    assert attachments.attachments
    assert storage.deleted == []
    assert events.events == []


async def test_message_retention_soft_deletes_expired_and_preserves_body_in_audit() -> None:
    ana, conversation, conversations = build_stack()
    messages = FakeMessageRepository()
    expired = await messages.add(make_message(ana.id, conversation.id, "c1", OLD))
    fresh = await messages.add(make_message(ana.id, conversation.id, "c2", RECENT))
    attachments = FakeAttachmentRepository()
    storage = FakeFileStorage()
    events = FakeEventBus()

    use_case = RunRetention(
        messages,
        attachments,
        storage,
        RetentionPolicy(message_retention_days=30),
        events,
        FakeUnitOfWork(),
        FixedClock(NOW),
    )
    result = await use_case.execute(RetentionRunCommand())

    assert result.messages_purged == 1
    assert result.files_purged == 0

    # A vencida virou soft delete: corpo substituído, ator sistema (deleted_by None).
    deleted = next(m for m in messages.messages if m.id == expired.id)
    assert deleted.is_deleted
    assert deleted.body == "Mensagem removida"
    assert deleted.deleted_at == NOW
    assert deleted.deleted_by is None

    # A recente permanece intacta.
    intact = next(m for m in messages.messages if m.id == fresh.id)
    assert intact.deleted_at is None
    assert intact.body == "conteúdo original"

    # Auditoria message.purge: ator sistema rastreável + corpo original.
    records = audit_events(events)
    assert [r.action for r in records] == ["message.purge"]
    assert records[0].actor_id is None
    assert records[0].metadata["actor"] == "system"
    assert records[0].metadata["retention_days"] == 30
    assert records[0].metadata["original_body"] == "conteúdo original"
    assert records[0].metadata["conversation_id"] == str(conversation.id)


async def test_file_retention_removes_disk_blob_and_row_with_audit() -> None:
    ana, conversation, conversations = build_stack()
    messages = FakeMessageRepository()
    attachments = FakeAttachmentRepository()
    expired_attachment = make_attachment(ana.id, OLD).link(uuid4())
    fresh_attachment = make_attachment(ana.id, RECENT).link(uuid4())
    attachments.attachments.extend([expired_attachment, fresh_attachment])
    storage = FakeFileStorage()
    events = FakeEventBus()

    use_case = RunRetention(
        messages,
        attachments,
        storage,
        RetentionPolicy(file_retention_days=30),
        events,
        FakeUnitOfWork(),
        FixedClock(NOW),
    )
    result = await use_case.execute(RetentionRunCommand())

    assert result.files_purged == 1
    assert result.messages_purged == 0

    # Blob E prévia removidos do disco; a row sumiu da tabela.
    assert storage.deleted == ["files/2026/11/velho", "thumbs/2026/11/velho.jpg"]
    assert [a.id for a in attachments.attachments] == [fresh_attachment.id]

    records = audit_events(events)
    assert [r.action for r in records] == ["file.purge"]
    assert records[0].actor_id is None
    assert records[0].metadata["actor"] == "system"
    assert records[0].metadata["filename"] == "laudo-velho.pdf"
    assert records[0].metadata["message_id"] == str(expired_attachment.message_id)


async def test_message_and_file_retention_run_together() -> None:
    ana, conversation, conversations = build_stack()
    messages = FakeMessageRepository()
    await messages.add(make_message(ana.id, conversation.id, "c1", OLD))
    attachments = FakeAttachmentRepository()
    attachments.attachments.append(make_attachment(ana.id, OLD))
    storage = FakeFileStorage()
    events = FakeEventBus()

    use_case = RunRetention(
        messages,
        attachments,
        storage,
        RetentionPolicy(message_retention_days=30, file_retention_days=30),
        events,
        FakeUnitOfWork(),
        FixedClock(NOW),
    )
    result = await use_case.execute(RetentionRunCommand())

    assert result == type(result)(messages_purged=1, files_purged=1)
    assert sorted(r.action for r in audit_events(events)) == ["file.purge", "message.purge"]
    assert storage.deleted  # disco tocado
