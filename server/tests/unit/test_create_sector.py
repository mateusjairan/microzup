from dataclasses import dataclass, field
from datetime import UTC, datetime
from types import TracebackType

import pytest
from app.application.use_cases.create_sector import CreateSector, CreateSectorCommand
from app.domain.entities.sector import Sector
from app.domain.exceptions import SectorAlreadyExists, ValidationError

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)


class FixedClock:
    def now(self) -> datetime:
        return NOW


@dataclass
class FakeSectorRepository:
    sectors: list[Sector] = field(default_factory=list)

    async def add(self, sector: Sector) -> None:
        self.sectors.append(sector)

    async def get_by_slug(self, slug: str) -> Sector | None:
        return next((sector for sector in self.sectors if sector.slug == slug), None)

    async def get_by_name(self, name: str) -> Sector | None:
        return next((sector for sector in self.sectors if sector.name == name), None)

    async def list_all(self) -> list[Sector]:
        return list(self.sectors)


@dataclass
class FakeUnitOfWork:
    commits: int = 0
    rollbacks: int = 0

    async def __aenter__(self) -> "FakeUnitOfWork":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if exc_type is None:
            self.commits += 1
        else:
            self.rollbacks += 1


def build_use_case(
    repository: FakeSectorRepository | None = None,
    uow: FakeUnitOfWork | None = None,
) -> tuple[CreateSector, FakeSectorRepository, FakeUnitOfWork]:
    repo = repository or FakeSectorRepository()
    unit = uow or FakeUnitOfWork()
    return CreateSector(repo, unit, FixedClock()), repo, unit


async def test_creates_sector_with_normalized_slug() -> None:
    use_case, repo, uow = build_use_case()

    sector = await use_case.execute(CreateSectorCommand(name="Qualidade e Assuntos Regulatórios"))

    assert sector.slug == "qualidade-e-assuntos-regulatorios"
    assert sector.created_at == NOW
    assert repo.sectors == [sector]
    assert uow.commits == 1


async def test_rejects_duplicate_slug_without_touching_transaction() -> None:
    existing = Sector.create("Qualidade", None, NOW)
    repo = FakeSectorRepository(sectors=[existing])
    use_case, _, uow = build_use_case(repository=repo)

    with pytest.raises(SectorAlreadyExists):
        await use_case.execute(CreateSectorCommand(name="Qualidade"))

    assert repo.sectors == [existing]
    assert uow.commits == 0
    assert uow.rollbacks == 0


async def test_rejects_name_shorter_than_two_characters() -> None:
    use_case, repo, _ = build_use_case()

    with pytest.raises(ValidationError):
        await use_case.execute(CreateSectorCommand(name="A"))

    assert repo.sectors == []
