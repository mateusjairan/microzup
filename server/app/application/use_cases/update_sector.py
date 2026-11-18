from dataclasses import dataclass
from uuid import UUID

from app.domain.entities.sector import Sector
from app.domain.exceptions import NotFoundError, SectorAlreadyExists
from app.domain.ports.audit import AuditLogSink
from app.domain.ports.clock import Clock
from app.domain.ports.repositories import ConversationRepository, SectorRepository
from app.domain.ports.unit_of_work import UnitOfWork


@dataclass(frozen=True, slots=True)
class UpdateSectorCommand:
    target_id: UUID
    name: str
    description: str | None
    actor_id: UUID | None = None
    ip: str | None = None


class UpdateSector:
    def __init__(
        self,
        sectors: SectorRepository,
        conversations: ConversationRepository,
        audit: AuditLogSink,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._sectors = sectors
        self._conversations = conversations
        self._audit = audit
        self._uow = uow
        self._clock = clock

    async def execute(self, command: UpdateSectorCommand) -> Sector:
        target = await self._sectors.get_by_id(command.target_id)
        if target is None:
            raise NotFoundError("Setor não encontrado.")

        updated = target.with_details(command.name, command.description)

        if updated.slug != target.slug:
            existing = await self._sectors.get_by_slug(updated.slug)
            if existing is not None and existing.id != target.id:
                raise SectorAlreadyExists(f"Setor '{updated.name}' já existe.")

        async with self._uow:
            await self._sectors.update(updated)
            if updated.name != target.name:
                channel = await self._conversations.get_channel_by_sector(target.id)
                if channel is not None:
                    await self._conversations.update(channel.with_name(updated.name))
            await self._audit.record(
                "sector.update",
                "sector",
                str(updated.id),
                command.actor_id,
                {"name": updated.name, "description": updated.description},
                command.ip,
            )

        return updated
