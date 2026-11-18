from datetime import datetime
from typing import Any, ClassVar
from uuid import UUID

from sqlalchemy import ColumnElement, delete, func, select

from app.domain.entities.attachment import Attachment, AttachmentHit
from app.infrastructure.db.mappers import attachment_to_domain, attachment_to_row
from app.infrastructure.db.models import AttachmentRow, ConversationMemberRow, MessageRow
from app.infrastructure.db.repositories.base import BaseSqlAlchemyRepository


class SqlAlchemyAttachmentRepository(BaseSqlAlchemyRepository[AttachmentRow, Attachment]):
    _row_type: ClassVar[type[AttachmentRow]] = AttachmentRow

    def _to_domain(self, row: AttachmentRow) -> Attachment:
        return attachment_to_domain(row)

    async def add(self, attachment: Attachment) -> None:
        self._session.add(attachment_to_row(attachment))
        await self._session.flush()

    async def update(self, attachment: Attachment) -> None:
        row = await self._session.get(AttachmentRow, attachment.id)
        if row is not None:
            row.message_id = attachment.message_id
            row.thumbnail_path = attachment.thumbnail_path
            await self._session.flush()

    async def get_by_sha256(self, sha256: str) -> Attachment | None:
        row = await self._session.scalar(
            select(AttachmentRow).where(AttachmentRow.sha256 == sha256)
        )
        return None if row is None else attachment_to_domain(row)

    async def list_orphans_older_than(self, before: datetime) -> list[Attachment]:
        rows = (
            await self._session.scalars(
                select(AttachmentRow).where(
                    AttachmentRow.message_id.is_(None), AttachmentRow.created_at < before
                )
            )
        ).all()
        return [self._to_domain(row) for row in rows]

    async def list_by_message(self, message_id: UUID) -> list[Attachment]:
        rows = (
            await self._session.scalars(
                select(AttachmentRow).where(AttachmentRow.message_id == message_id)
            )
        ).all()
        return [self._to_domain(row) for row in rows]

    async def search_by_filename(
        self,
        user_id: UUID,
        query: str,
        conversation_id: UUID | None,
        limit: int,
    ) -> list[AttachmentHit]:
        """Busca por NOME DE ARQUIVO com o índice trigram (plano §5:
        `attachments_filename_trgm_idx`, `pg_trgm`).

        `filename %> termo` é `word_similarity` — atende "digitei parte do
        nome" e aproveita o GIN. Consulta multi-palavra exige similaridade com
        TODOS os termos (mesma semântica AND da busca full-text de mensagens);
        a ordenação é pela soma das similaridades. Só anexos vinculados a
        mensagens visíveis ao usuário (membro ativo, mensagem não removida).
        """
        terms = [term for term in query.split() if term][:5]
        similarities = [func.word_similarity(term, AttachmentRow.filename) for term in terms]
        statement = (
            select(
                AttachmentRow,
                MessageRow.conversation_id,
                MessageRow.seq,
                MessageRow.created_at,
            )
            .join(MessageRow, MessageRow.id == AttachmentRow.message_id)
            .join(
                ConversationMemberRow,
                ConversationMemberRow.conversation_id == MessageRow.conversation_id,
            )
            .where(
                ConversationMemberRow.user_id == user_id,
                ConversationMemberRow.left_at.is_(None),
                MessageRow.deleted_at.is_(None),
                # `filename %> termo` é a forma comutada de `termo <% filename`:
                # "o termo buscado é word-similar a um trecho do nome do arquivo".
                *(AttachmentRow.filename.op("%>")(term) for term in terms),
            )
        )
        if conversation_id is not None:
            statement = statement.where(MessageRow.conversation_id == conversation_id)
        ranking: ColumnElement[Any] = similarities[0]
        for extra in similarities[1:]:
            ranking = ranking + extra
        statement = statement.order_by(ranking.desc()).limit(limit)
        rows = (await self._session.execute(statement)).all()
        return [
            AttachmentHit(
                attachment=self._to_domain(row),
                conversation_id=conversation_id_,
                message_seq=seq,
                message_created_at=created_at,
            )
            for row, conversation_id_, seq, created_at in rows
        ]

    async def list_expired(self, before: datetime, limit: int) -> list[Attachment]:
        """Candidatos à retenção de arquivos: criados antes do corte."""
        rows = (
            await self._session.scalars(
                select(AttachmentRow)
                .where(AttachmentRow.created_at < before)
                .order_by(AttachmentRow.created_at.asc())
                .limit(limit)
            )
        ).all()
        return [self._to_domain(row) for row in rows]

    async def delete(self, attachment: Attachment) -> None:
        await self._session.execute(delete(AttachmentRow).where(AttachmentRow.id == attachment.id))
        await self._session.flush()
