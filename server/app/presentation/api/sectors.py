from fastapi import APIRouter

from app.infrastructure.db.repositories.sectors import SqlAlchemySectorRepository
from app.presentation.api.schemas import SectorOut
from app.presentation.deps import CurrentUserDep, SessionDep

router = APIRouter(tags=["sectors"])


@router.get("/sectors", response_model=list[SectorOut])
async def list_sectors(_: CurrentUserDep, session: SessionDep) -> list[SectorOut]:
    """Setores visíveis a qualquer usuário autenticado (plano §6: GET /sectors)."""
    sectors = await SqlAlchemySectorRepository(session).list_all()
    return [
        SectorOut(id=s.id, name=s.name, slug=s.slug, description=s.description) for s in sectors
    ]
