from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.db.models import AuditLogRow


class SqlAlchemyAuditSink:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def record(
        self,
        action: str,
        entity_type: str,
        entity_id: str | None,
        actor_id: UUID | None,
        metadata: dict[str, Any] | None,
        ip: str | None,
    ) -> None:
        self._session.add(
            AuditLogRow(
                actor_id=actor_id,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                meta=metadata or {},
                ip=ip,
            )
        )
        await self._session.flush()
