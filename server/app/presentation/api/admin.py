import ipaddress
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import func, select

from app.application.use_cases.create_sector import CreateSectorCommand
from app.application.use_cases.create_user import CreateUserCommand
from app.application.use_cases.reset_password import ResetPasswordCommand
from app.application.use_cases.update_sector import UpdateSectorCommand
from app.application.use_cases.update_user import UpdateUserCommand
from app.infrastructure.db.models import (
    AttachmentRow,
    AuditLogRow,
    ConversationRow,
    MessageRow,
    SectorRow,
    UserRow,
)
from app.infrastructure.db.repositories.sectors import SqlAlchemySectorRepository
from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
from app.presentation.api.schemas import (
    AuditOut,
    CreateSectorIn,
    CreateUserIn,
    ResetPasswordIn,
    SectorOut,
    StatsOut,
    UpdateSectorIn,
    UpdateUserIn,
    UserOut,
)
from app.presentation.deps import (
    AdminDep,
    CreateSectorDep,
    CreateUserDep,
    ResetPasswordDep,
    SessionDep,
    UpdateSectorDep,
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
async def list_users(
    _: AdminDep, session: SessionDep, include_inactive: bool = False
) -> list[UserOut]:
    repo = SqlAlchemyUserRepository(session)
    users = await repo.list_all() if include_inactive else await repo.list_active()
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
            clear_sector=body.clear_sector,
            is_active=body.is_active,
            ip=_ip(request),
        )
    )
    return UserOut.from_user(user)


@router.post("/users/{user_id}/password", response_model=UserOut, status_code=status.HTTP_200_OK)
async def reset_user_password(
    user_id: UUID,
    body: ResetPasswordIn,
    request: Request,
    admin: AdminDep,
    use_case: ResetPasswordDep,
) -> UserOut:
    user = await use_case.execute(
        ResetPasswordCommand(
            target_id=user_id,
            new_password=body.new_password,
            actor_id=admin.id,
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


@router.patch("/sectors/{sector_id}", response_model=SectorOut)
async def update_sector(
    sector_id: UUID,
    body: UpdateSectorIn,
    request: Request,
    admin: AdminDep,
    use_case: UpdateSectorDep,
) -> SectorOut:
    sector = await use_case.execute(
        UpdateSectorCommand(
            target_id=sector_id,
            name=body.name,
            description=body.description,
            actor_id=admin.id,
            ip=_ip(request),
        )
    )
    return SectorOut(
        id=sector.id, name=sector.name, slug=sector.slug, description=sector.description
    )


@router.get("/audit", response_model=list[AuditOut])
async def list_audit(
    _: AdminDep,
    session: SessionDep,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    action: str | None = None,
    actor_id: UUID | None = None,
) -> list[AuditOut]:
    statement = select(AuditLogRow).order_by(AuditLogRow.id.desc())
    if action:
        statement = statement.where(AuditLogRow.action == action)
    if actor_id is not None:
        statement = statement.where(AuditLogRow.actor_id == actor_id)
    rows = (await session.scalars(statement.offset(offset).limit(limit))).all()
    return [
        AuditOut(
            id=row.id,
            actor_id=row.actor_id,
            action=row.action,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            metadata=row.meta,
            ip=None if row.ip is None else str(row.ip),
            created_at=row.created_at.isoformat(),
        )
        for row in rows
    ]


@router.get("/stats", response_model=StatsOut)
async def stats(_: AdminDep, session: SessionDep) -> StatsOut:
    async def count(model: Any) -> int:
        value = await session.scalar(select(func.count()).select_from(model))
        return int(value or 0)

    return StatsOut(
        users=await count(UserRow),
        sectors=await count(SectorRow),
        conversations=await count(ConversationRow),
        messages=await count(MessageRow),
        attachments=await count(AttachmentRow),
    )
