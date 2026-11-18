from datetime import datetime
from typing import ClassVar
from uuid import UUID

from sqlalchemy import func, select

from app.domain.entities.message import Message
from app.infrastructure.db.mappers import message_to_domain, message_to_row
from app.infrastructure.db.models import ConversationMemberRow, MessageRow
from app.infrastructure.db.repositories.base import BaseSqlAlchemyRepository


class SqlAlchemyMessageRepository(BaseSqlAlchemyRepository[MessageRow, Message]):
    _row_type: ClassVar[type[MessageRow]] = MessageRow

    def _to_domain(self, row: MessageRow) -> Message:
        return message_to_domain(row)

    async def add(self, message: Message) -> Message:
        row = message_to_row(message)
        self._session.add(row)
        await self._session.flush()
        await self._session.refresh(row)
        return message_to_domain(row)

    async def update(self, message: Message) -> None:
        row = await self._session.get(MessageRow, message.id)
        if row is None:
            return
        row.body = message.body
        row.edited_at = message.edited_at
        row.deleted_at = message.deleted_at
        row.deleted_by = message.deleted_by
        await self._session.flush()

    async def get_by_client_id(self, conversation_id: UUID, client_id: str) -> Message | None:
        row = await self._session.scalar(
            select(MessageRow).where(
                MessageRow.conversation_id == conversation_id,
                MessageRow.client_id == client_id,
            )
        )
        return None if row is None else message_to_domain(row)

    async def page(
        self,
        conversation_id: UUID,
        before_seq: int | None,
        after_seq: int | None,
        limit: int,
    ) -> list[Message]:
        statement = select(MessageRow).where(MessageRow.conversation_id == conversation_id)
        rows = await self.page_by_seq(statement, MessageRow.seq, before_seq, after_seq, limit)
        return [self._to_domain(row) for row in rows]

    async def last(self, conversation_id: UUID) -> Message | None:
        row = await self._session.scalar(
            select(MessageRow)
            .where(MessageRow.conversation_id == conversation_id)
            .order_by(MessageRow.seq.desc())
            .limit(1)
        )
        return None if row is None else message_to_domain(row)

    async def unread_count(self, conversation_id: UUID, last_read_seq: int) -> int:
        count = await self._session.scalar(
            select(func.count(MessageRow.id)).where(
                MessageRow.conversation_id == conversation_id,
                MessageRow.seq > last_read_seq,
            )
        )
        return int(count or 0)

    async def search(
        self,
        user_id: UUID,
        query: str,
        conversation_id: UUID | None,
        limit: int,
    ) -> list[Message]:
        """Full-text com ranking `ts_rank_cd` (plano §5), restrito às conversas
        do usuário via `conversation_members`; mensagens removidas não aparecem.
        """
        ts_query = func.websearch_to_tsquery("portuguese", query)
        rank = func.ts_rank_cd(MessageRow.search_vector, ts_query)
        statement = (
            select(MessageRow)
            .join(
                ConversationMemberRow,
                ConversationMemberRow.conversation_id == MessageRow.conversation_id,
            )
            .where(
                ConversationMemberRow.user_id == user_id,
                ConversationMemberRow.left_at.is_(None),
                MessageRow.deleted_at.is_(None),
                MessageRow.search_vector.bool_op("@@")(ts_query),
            )
        )
        if conversation_id is not None:
            statement = statement.where(MessageRow.conversation_id == conversation_id)
        rows = (
            await self._session.scalars(
                statement.order_by(rank.desc(), MessageRow.seq.desc()).limit(limit)
            )
        ).all()
        return [self._to_domain(row) for row in rows]

    async def list_expired(self, before: datetime, limit: int) -> list[Message]:
        """Candidatas à retenção: não removidas e criadas antes do corte."""
        rows = (
            await self._session.scalars(
                select(MessageRow)
                .where(MessageRow.deleted_at.is_(None), MessageRow.created_at < before)
                .order_by(MessageRow.created_at.asc())
                .limit(limit)
            )
        ).all()
        return [self._to_domain(row) for row in rows]
