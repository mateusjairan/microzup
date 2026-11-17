from typing import Any, Protocol
from uuid import UUID


class AuditLogSink(Protocol):
    async def record(
        self,
        action: str,
        entity_type: str,
        entity_id: str | None,
        actor_id: UUID | None,
        metadata: dict[str, Any] | None,
        ip: str | None,
    ) -> None: ...
