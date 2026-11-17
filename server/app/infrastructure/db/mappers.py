from app.domain.entities.sector import Sector
from app.infrastructure.db.models import SectorRow


def sector_to_domain(row: SectorRow) -> Sector:
    return Sector(
        id=row.id,
        name=row.name,
        slug=row.slug,
        description=row.description,
        created_at=row.created_at,
    )


def sector_to_row(sector: Sector) -> SectorRow:
    return SectorRow(
        id=sector.id,
        name=sector.name,
        slug=sector.slug,
        description=sector.description,
        created_at=sector.created_at,
    )
