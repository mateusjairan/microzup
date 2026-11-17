from dataclasses import dataclass

from app.domain.entities.sector import Sector
from app.domain.exceptions import SectorAlreadyExists
from app.domain.ports.clock import Clock
from app.domain.ports.repositories import SectorRepository
from app.domain.ports.unit_of_work import UnitOfWork


@dataclass(frozen=True, slots=True)
class CreateSectorCommand:
    name: str
    description: str | None = None


class CreateSector:
    def __init__(
        self,
        sectors: SectorRepository,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._sectors = sectors
        self._uow = uow
        self._clock = clock

    async def execute(self, command: CreateSectorCommand) -> Sector:
        sector = Sector.create(command.name, command.description, self._clock.now())

        if await self._sectors.get_by_slug(sector.slug) is not None:
            raise SectorAlreadyExists(f"Setor '{sector.name}' já existe.")

        async with self._uow:
            await self._sectors.add(sector)

        return sector
