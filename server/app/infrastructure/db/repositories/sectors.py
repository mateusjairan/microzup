from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.sector import Sector
from app.infrastructure.db.mappers import sector_to_domain, sector_to_row
from app.infrastructure.db.models import SectorRow


class SqlAlchemySectorRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, sector: Sector) -> None:
        self._session.add(sector_to_row(sector))
        await self._session.flush()

    async def get_by_slug(self, slug: str) -> Sector | None:
        row = await self._session.scalar(select(SectorRow).where(SectorRow.slug == slug))
        return None if row is None else sector_to_domain(row)

    async def get_by_name(self, name: str) -> Sector | None:
        row = await self._session.scalar(select(SectorRow).where(SectorRow.name == name))
        return None if row is None else sector_to_domain(row)

    async def list_all(self) -> list[Sector]:
        rows = (await self._session.scalars(select(SectorRow).order_by(SectorRow.name))).all()
        return [sector_to_domain(row) for row in rows]
