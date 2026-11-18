from app.application.dto import UpdateSectorCommand
from app.domain.entities.sector import Sector
from app.domain.exceptions import NotFoundError, SectorAlreadyExists
from app.domain.ports.clock import Clock
from app.domain.ports.repositories import ConversationRepository, SectorRepository
from app.domain.ports.unit_of_work import UnitOfWork

__all__ = ["UpdateSector", "UpdateSectorCommand"]


class UpdateSector:
    """Atualiza setor (e renomeia o canal vinculado, plano §5).

    A auditoria `sector.update` é aplicada por composição com o decorator
    `@audit` na borda de DI (deps.py) — não dentro da regra.
    """

    def __init__(
        self,
        sectors: SectorRepository,
        conversations: ConversationRepository,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._sectors = sectors
        self._conversations = conversations
        self._uow = uow
        self._clock = clock

    async def execute(self, command: UpdateSectorCommand) -> Sector:
        target = await self._sectors.get_or_raise(
            command.target_id, NotFoundError("Setor não encontrado.")
        )

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

        return updated
