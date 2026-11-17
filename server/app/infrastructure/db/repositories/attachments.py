from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.attachment import Attachment
from app.infrastructure.db.mappers import attachment_to_domain, attachment_to_row
from app.infrastructure.db.models import AttachmentRow


class SqlAlchemyAttachmentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, attachment: Attachment) -> None:
        self._session.add(attachment_to_row(attachment))
        await self._session.flush()

    async def update(self, attachment: Attachment) -> None:
        row = await self._session.get(AttachmentRow, attachment.id)
        if row is not None:
            row.message_id = attachment.message_id
            await self._session.flush()

    async def get_by_id(self, attachment_id: UUID) -> Attachment | None:
        row = await self._session.get(AttachmentRow, attachment_id)
        return None if row is None else attachment_to_domain(row)

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
        return [attachment_to_domain(row) for row in rows]

    async def delete(self, attachment: Attachment) -> None:
        await self._session.execute(delete(AttachmentRow).where(AttachmentRow.id == attachment.id))
        await self._session.flush()
