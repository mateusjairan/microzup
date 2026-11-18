from typing import ClassVar

from sqlalchemy import select

from app.domain.entities.sector import Sector
from app.infrastructure.db.mappers import sector_to_domain, sector_to_row
from app.infrastructure.db.models import SectorRow
from app.infrastructure.db.repositories.base import BaseSqlAlchemyRepository


class SqlAlchemySectorRepository(BaseSqlAlchemyRepository[SectorRow, Sector]):
    _row_type: ClassVar[type[SectorRow]] = SectorRow

    def _to_domain(self, row: SectorRow) -> Sector:
        return sector_to_domain(row)

    async def add(self, sector: Sector) -> None:
        self._session.add(sector_to_row(sector))
        await self._session.flush()

    async def update(self, sector: Sector) -> None:
        await self._session.merge(sector_to_row(sector))
        await self._session.flush()

    async def get_by_slug(self, slug: str) -> Sector | None:
        row = await self._session.scalar(select(SectorRow).where(SectorRow.slug == slug))
        return None if row is None else sector_to_domain(row)

    async def get_by_name(self, name: str) -> Sector | None:
        row = await self._session.scalar(select(SectorRow).where(SectorRow.name == name))
        return None if row is None else sector_to_domain(row)

    async def list_all(self) -> list[Sector]:
        rows = (await self._session.scalars(select(SectorRow).order_by(SectorRow.name))).all()
        return [self._to_domain(row) for row in rows]
