from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.conversation import Conversation, ConversationMember
from app.infrastructure.db.mappers import (
    conversation_to_domain,
    conversation_to_row,
    member_to_domain,
    member_to_row,
)
from app.infrastructure.db.models import ConversationMemberRow, ConversationRow


def _dm_key(user_a: UUID, user_b: UUID) -> str:
    ordered = sorted((str(user_a), str(user_b)))
    return f"{ordered[0]}:{ordered[1]}"


class SqlAlchemyConversationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, conversation: Conversation) -> None:
        self._session.add(conversation_to_row(conversation))
        await self._session.flush()

    async def get_by_id(self, conversation_id: UUID) -> Conversation | None:
        row = await self._session.get(ConversationRow, conversation_id)
        return None if row is None else conversation_to_domain(row)

    async def get_channel_by_sector(self, sector_id: UUID) -> Conversation | None:
        row = await self._session.scalar(
            select(ConversationRow).where(
                ConversationRow.kind == "channel", ConversationRow.sector_id == sector_id
            )
        )
        return None if row is None else conversation_to_domain(row)

    async def get_dm(self, user_a: UUID, user_b: UUID) -> Conversation | None:
        row = await self._session.scalar(
            select(ConversationRow).where(
                ConversationRow.kind == "dm", ConversationRow.dm_key == _dm_key(user_a, user_b)
            )
        )
        return None if row is None else conversation_to_domain(row)

    async def list_for_user(self, user_id: UUID) -> list[Conversation]:
        rows = (
            await self._session.scalars(
                select(ConversationRow)
                .join(
                    ConversationMemberRow,
                    ConversationMemberRow.conversation_id == ConversationRow.id,
                )
                .where(
                    ConversationMemberRow.user_id == user_id,
                    ConversationMemberRow.left_at.is_(None),
                )
                .order_by(ConversationRow.created_at)
            )
        ).all()
        return [conversation_to_domain(row) for row in rows]

    async def add_member(self, member: ConversationMember) -> None:
        self._session.add(member_to_row(member))
        await self._session.flush()

    async def update_member(self, member: ConversationMember) -> None:
        await self._session.merge(member_to_row(member))
        await self._session.flush()

    async def get_member(self, conversation_id: UUID, user_id: UUID) -> ConversationMember | None:
        row = await self._session.get(ConversationMemberRow, (conversation_id, user_id))
        return None if row is None else member_to_domain(row)

    async def list_members(self, conversation_id: UUID) -> list[ConversationMember]:
        rows = (
            await self._session.scalars(
                select(ConversationMemberRow).where(
                    ConversationMemberRow.conversation_id == conversation_id
                )
            )
        ).all()
        return [member_to_domain(row) for row in rows]
