import pytest
from app.domain.entities.sector import Sector
from app.infrastructure.clock import SystemClock
from app.infrastructure.db.repositories.sectors import SqlAlchemySectorRepository
from app.infrastructure.db.uow import SqlAlchemyUnitOfWork

pytestmark = pytest.mark.integration


async def test_round_trip_sector_through_postgres(session) -> None:
    repo = SqlAlchemySectorRepository(session)
    sector = Sector.create("Qualidade", "Assuntos regulatórios", SystemClock().now())

    async with SqlAlchemyUnitOfWork(session):
        await repo.add(sector)

    stored = await repo.get_by_slug(sector.slug)

    assert stored == sector
    assert await repo.get_by_name("Qualidade") == sector
    assert await repo.list_all() == [sector]
