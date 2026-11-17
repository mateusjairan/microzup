from uuid import UUID

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.db.models import MessageReadRow


class SqlAlchemyMessageReadRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def upsert(self, conversation_id: UUID, user_id: UUID, last_read_seq: int) -> None:
        statement = pg_insert(MessageReadRow).values(
            conversation_id=conversation_id,
            user_id=user_id,
            last_read_seq=last_read_seq,
        )
        statement = statement.on_conflict_do_update(
            index_elements=[MessageReadRow.conversation_id, MessageReadRow.user_id],
            set_={"last_read_seq": last_read_seq, "updated_at": statement.excluded.updated_at},
        )
        await self._session.execute(statement)
        await self._session.flush()

    async def get(self, conversation_id: UUID, user_id: UUID) -> int:
        row = await self._session.get(MessageReadRow, (conversation_id, user_id))
        return 0 if row is None else int(row.last_read_seq)
