from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.message import Message
from app.infrastructure.db.mappers import message_to_domain, message_to_row
from app.infrastructure.db.models import ConversationMemberRow, MessageRow


class SqlAlchemyMessageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

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

    async def get_by_id(self, message_id: UUID) -> Message | None:
        row = await self._session.get(MessageRow, message_id)
        return None if row is None else message_to_domain(row)

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
        query = select(MessageRow).where(MessageRow.conversation_id == conversation_id)
        if before_seq is not None:
            rows = (
                await self._session.scalars(
                    query.where(MessageRow.seq < before_seq)
                    .order_by(MessageRow.seq.desc())
                    .limit(limit)
                )
            ).all()
            return [message_to_domain(r) for r in reversed(rows)]
        if after_seq is not None:
            query = query.where(MessageRow.seq > after_seq)
        rows = (
            await self._session.scalars(query.order_by(MessageRow.seq.asc()).limit(limit))
        ).all()
        return [message_to_domain(row) for row in rows]

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

    async def search(self, user_id: UUID, query: str, limit: int) -> list[Message]:
        statement = (
            select(MessageRow)
            .join(
                ConversationMemberRow,
                ConversationMemberRow.conversation_id == MessageRow.conversation_id,
            )
            .where(
                ConversationMemberRow.user_id == user_id,
                ConversationMemberRow.left_at.is_(None),
                MessageRow.search_vector.bool_op("@@")(
                    func.websearch_to_tsquery("portuguese", query)
                ),
            )
            .order_by(MessageRow.seq.desc())
            .limit(limit)
        )
        rows = (await self._session.scalars(statement)).all()
        return [message_to_domain(row) for row in rows]
