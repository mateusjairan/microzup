import ipaddress
from uuid import UUID

from fastapi import APIRouter, Request, status

from app.application.use_cases.create_sector import CreateSectorCommand
from app.application.use_cases.create_user import CreateUserCommand
from app.application.use_cases.update_user import UpdateUserCommand
from app.infrastructure.db.repositories.sectors import SqlAlchemySectorRepository
from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
from app.presentation.api.schemas import (
    CreateSectorIn,
    CreateUserIn,
    SectorOut,
    UpdateUserIn,
    UserOut,
)
from app.presentation.deps import (
    AdminDep,
    CreateSectorDep,
    CreateUserDep,
    SessionDep,
    UpdateUserDep,
)

router = APIRouter(prefix="/admin", tags=["admin"])


def _ip(request: Request) -> str | None:
    host = request.client.host if request.client is not None else None
    if host is None:
        return None
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return None
    return host


@router.get("/users", response_model=list[UserOut])
async def list_users(_: AdminDep, session: SessionDep) -> list[UserOut]:
    users = await SqlAlchemyUserRepository(session).list_active()
    return [UserOut.from_user(user) for user in users]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: CreateUserIn,
    request: Request,
    admin: AdminDep,
    use_case: CreateUserDep,
) -> UserOut:
    user = await use_case.execute(
        CreateUserCommand(
            username=body.username,
            display_name=body.display_name,
            password=body.password,
            role=body.role,
            sector_id=body.sector_id,
            actor_id=admin.id,
            ip=_ip(request),
        )
    )
    return UserOut.from_user(user)


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: UUID,
    body: UpdateUserIn,
    request: Request,
    admin: AdminDep,
    use_case: UpdateUserDep,
) -> UserOut:
    user = await use_case.execute(
        UpdateUserCommand(
            target_id=user_id,
            actor_id=admin.id,
            role=body.role,
            sector_id=body.sector_id,
            is_active=body.is_active,
            ip=_ip(request),
        )
    )
    return UserOut.from_user(user)


@router.get("/sectors", response_model=list[SectorOut])
async def list_sectors(_: AdminDep, session: SessionDep) -> list[SectorOut]:
    sectors = await SqlAlchemySectorRepository(session).list_all()
    return [
        SectorOut(id=s.id, name=s.name, slug=s.slug, description=s.description) for s in sectors
    ]


@router.post("/sectors", response_model=SectorOut, status_code=status.HTTP_201_CREATED)
async def create_sector(body: CreateSectorIn, use_case: CreateSectorDep) -> SectorOut:
    sector = await use_case.execute(
        CreateSectorCommand(name=body.name, description=body.description)
    )
    return SectorOut(
        id=sector.id, name=sector.name, slug=sector.slug, description=sector.description
    )
