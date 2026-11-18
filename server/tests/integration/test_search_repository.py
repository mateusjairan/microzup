"""Busca avançada contra Postgres real (plano §5/§6).

Cobre: termo em mensagem, filtro por conversa, ranking `ts_rank_cd`, termo no
NOME DE ARQUIVO via índice trigram (`pg_trgm`) e isolamento por acesso —
usuário fora da conversa não vê resultado algum.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from app.domain.entities.attachment import Attachment
from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.entities.message import Message
from app.domain.entities.user import User, Username
from app.domain.value_objects.file_name import FileName
from app.domain.value_objects.file_size import FileSize
from app.domain.value_objects.message_body import MessageBody
from app.domain.value_objects.sha256 import Sha256
from app.infrastructure.db.repositories.attachments import SqlAlchemyAttachmentRepository
from app.infrastructure.db.repositories.conversations import SqlAlchemyConversationRepository
from app.infrastructure.db.repositories.messages import SqlAlchemyMessageRepository
from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
from app.infrastructure.db.uow import SqlAlchemyUnitOfWork

pytestmark = pytest.mark.integration

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)


async def _make_user(session, username: str) -> User:
    repo = SqlAlchemyUserRepository(session)
    user = User.create(Username(username), username, "member", None, f"hash:{username}", NOW)
    await repo.add(user)
    return user


async def _open_dm(session, user_a: User, user_b: User) -> Conversation:
    conversations = SqlAlchemyConversationRepository(session)
    conversation = Conversation.create_dm(user_a.id, user_b.id, NOW)
    async with SqlAlchemyUnitOfWork(session):
        await conversations.add(conversation)
        await conversations.add_member(ConversationMember.create(conversation.id, user_a.id, NOW))
        await conversations.add_member(ConversationMember.create(conversation.id, user_b.id, NOW))
    return conversation


async def _send(session, conversation_id, sender_id, client_id, body) -> Message:
    repo = SqlAlchemyMessageRepository(session)
    async with SqlAlchemyUnitOfWork(session):
        return await repo.add(
            Message.create(conversation_id, sender_id, client_id, MessageBody(body), NOW)
        )


async def _attach(session, uploader_id, filename: str, sha256: str, message: Message) -> None:
    repo = SqlAlchemyAttachmentRepository(session)
    async with SqlAlchemyUnitOfWork(session):
        await repo.add(
            Attachment.create(
                uploader_id=uploader_id,
                filename=FileName(filename),
                mime_type="application/pdf",
                size_bytes=FileSize(2048),
                sha256=Sha256(sha256),
                storage_path=f"files/2026/11/{sha256[:8]}",
                now=NOW,
            ).link(message.id)
        )


async def test_search_returns_only_messages_from_user_conversations(session) -> None:
    ana = await _make_user(session, "ana.souza")
    bruno = await _make_user(session, "bruno.lima")
    carla = await _make_user(session, "carla.dias")

    # Duas DMs: ana↔bruno (com o termo) e carla↔bruno (com o mesmo termo).
    dm_ana = await _open_dm(session, ana, bruno)
    dm_carla = await _open_dm(session, carla, bruno)

    await _send(session, dm_ana.id, ana.id, "c1", "Relatório de desvio farmacêutico")
    await _send(session, dm_carla.id, carla.id, "c2", "Outro desvio em outro contexto")

    messages = SqlAlchemyMessageRepository(session)

    # Bruno participa das duas → vê ambos os "desvio".
    bruno_hits = await messages.search(bruno.id, "desvio", None, 30)
    assert len(bruno_hits) == 2

    # Ana NÃO participa da DM carla↔bruno → só o resultado dela.
    ana_hits = await messages.search(ana.id, "desvio", None, 30)
    assert len(ana_hits) == 1
    assert ana_hits[0].conversation_id == dm_ana.id


async def test_search_filters_by_conversation_id(session) -> None:
    ana = await _make_user(session, "ana.souza")
    bruno = await _make_user(session, "bruno.lima")
    carla = await _make_user(session, "carla.dias")

    dm_a = await _open_dm(session, ana, bruno)
    dm_b = await _open_dm(session, ana, carla)

    await _send(session, dm_a.id, ana.id, "c1", "protocolo de higienização")
    await _send(session, dm_b.id, ana.id, "c2", "protocolo de calibração")

    messages = SqlAlchemyMessageRepository(session)
    hits = await messages.search(ana.id, "protocolo", dm_a.id, 30)
    assert [hit.conversation_id for hit in hits] == [dm_a.id]
    assert "higienização" in hits[0].body


async def test_search_ranks_by_ts_rank_cd(session) -> None:
    """O termo repetido ranca melhor que o termo isolado (ts_rank_cd)."""
    ana = await _make_user(session, "ana.souza")
    bruno = await _make_user(session, "bruno.lima")
    dm = await _open_dm(session, ana, bruno)

    await _send(session, dm.id, ana.id, "c1", "Validação é o tema da semana")
    await _send(session, dm.id, bruno.id, "c2", "Validação e qualificação: validação contínua")

    messages = SqlAlchemyMessageRepository(session)
    hits = await messages.search(ana.id, "validação", None, 30)

    assert len(hits) == 2
    # A mensagem com o termo repetido vem primeiro; empate quebra por seq desc.
    assert "contínua" in hits[0].body
    assert hits[0].seq > hits[1].seq


async def test_search_skips_deleted_messages(session) -> None:
    ana = await _make_user(session, "ana.souza")
    bruno = await _make_user(session, "bruno.lima")
    dm = await _open_dm(session, ana, bruno)

    message = await _send(session, dm.id, ana.id, "c1", "desvio confidencial")
    messages = SqlAlchemyMessageRepository(session)
    async with SqlAlchemyUnitOfWork(session):
        await messages.update(message.delete(ana.id, NOW))

    assert await messages.search(ana.id, "desvio", None, 30) == []


async def test_search_by_filename_uses_trigram_and_carries_context(session) -> None:
    ana = await _make_user(session, "ana.souza")
    bruno = await _make_user(session, "bruno.lima")
    carla = await _make_user(session, "carla.dias")

    dm_ana = await _open_dm(session, ana, bruno)
    dm_carla = await _open_dm(session, carla, bruno)

    message_ana = await _send(session, dm_ana.id, ana.id, "c1", "segue o laudo")
    message_carla = await _send(session, dm_carla.id, carla.id, "c2", "segue o laudo")

    await _attach(session, ana.id, "laudo-qualidade-2026.pdf", "a" * 64, message_ana)
    await _attach(session, carla.id, "laudo-manutencao.docx", "b" * 64, message_carla)

    attachments = SqlAlchemyAttachmentRepository(session)

    # Ana busca por parte do nome: encontra só o anexo da conversa dela.
    ana_hits = await attachments.search_by_filename(ana.id, "laudo qualidade", None, 30)
    assert [hit.attachment.filename for hit in ana_hits] == ["laudo-qualidade-2026.pdf"]
    hit = ana_hits[0]
    assert hit.conversation_id == dm_ana.id
    assert hit.message_seq == message_ana.seq
    assert hit.attachment.message_id == message_ana.id

    # Bruno participa das duas → vê os dois laudos.
    bruno_hits = await attachments.search_by_filename(bruno.id, "laudo", None, 30)
    assert len(bruno_hits) == 2

    # Multi-palavra exige similaridade com TODOS os termos (AND, como na
    # busca de mensagens): o laudo de manutenção não contém "qualidade".
    assert await attachments.search_by_filename(carla.id, "laudo qualidade", None, 30) == []

    # Carla não participa da DM ana↔bruno → nenhum resultado vaza: buscando
    # apenas "laudo", o que ela vê é somente o próprio anexo dela.
    carla_hits = await attachments.search_by_filename(carla.id, "laudo", None, 30)
    assert [h.attachment.filename for h in carla_hits] == ["laudo-manutencao.docx"]


async def test_search_by_filename_filters_by_conversation(session) -> None:
    ana = await _make_user(session, "ana.souza")
    bruno = await _make_user(session, "bruno.lima")
    carla = await _make_user(session, "carla.dias")

    dm = await _open_dm(session, ana, bruno)
    dm_carla = await _open_dm(session, ana, carla)

    message_dm = await _send(session, dm.id, ana.id, "c1", "laudo no direct")
    message_other = await _send(session, dm_carla.id, ana.id, "c2", "laudo na outra conversa")

    await _attach(session, ana.id, "laudo-dm.pdf", "c" * 64, message_dm)
    await _attach(session, ana.id, "laudo-outro.pdf", "d" * 64, message_other)

    attachments = SqlAlchemyAttachmentRepository(session)
    hits = await attachments.search_by_filename(ana.id, "laudo", dm.id, 30)
    assert [hit.attachment.filename for hit in hits] == ["laudo-dm.pdf"]
    assert hits[0].conversation_id == dm.id


async def test_get_or_raise_returns_or_raises(session) -> None:
    """Template Method da base: get_or_raise devolve ou levanta o erro dado."""
    user = await _make_user(session, "ana.souza")
    users = SqlAlchemyUserRepository(session)

    found = await users.get_or_raise(user.id, ValueError("não devia levantar"))
    assert found.id == user.id

    from app.domain.exceptions import NotFoundError

    with pytest.raises(NotFoundError):
        await users.get_or_raise(uuid4(), NotFoundError("Usuário não encontrado."))
