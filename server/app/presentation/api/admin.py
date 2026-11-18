import ipaddress
import shutil
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import func, select

from app.application.use_cases.conversations import UpdateChannelCommand
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
from app.infrastructure.db.repositories.conversations import SqlAlchemyConversationRepository
from app.infrastructure.db.repositories.sectors import SqlAlchemySectorRepository
from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
from app.presentation.api.schemas import (
    AuditOut,
    ChannelOut,
    CreateSectorIn,
    CreateUserIn,
    ResetPasswordIn,
    SectorOut,
    StatsOut,
    UpdateChannelIn,
    UpdateSectorIn,
    UpdateUserIn,
    UserOut,
)
from app.presentation.deps import (
    AdminDep,
    CreateSectorDep,
    CreateUserDep,
    ListChannelsDep,
    ResetPasswordDep,
    SessionDep,
    UpdateChannelDep,
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


def _storage_stats(root: Path) -> tuple[int, int]:
    total = 0
    files = 0
    if not root.exists():
        return 0, 0
    for path in root.rglob("*"):
        if path.is_file():
            try:
                total += path.stat().st_size
                files += 1
            except OSError:
                continue
    return total, files


def _disk_stats(root: Path) -> tuple[int, int]:
    probe = root if root.exists() else root.resolve()
    while not probe.exists():
        probe = probe.parent
    usage = shutil.disk_usage(probe)
    return usage.free, usage.total


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
async def create_sector(
    body: CreateSectorIn,
    request: Request,
    admin: AdminDep,
    use_case: CreateSectorDep,
) -> SectorOut:
    sector = await use_case.execute(
        CreateSectorCommand(
            name=body.name,
            description=body.description,
            actor_id=admin.id,
            ip=_ip(request),
        )
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


@router.get("/channels", response_model=list[ChannelOut])
async def list_channels(
    _: AdminDep,
    use_case: ListChannelsDep,
    sector_id: Annotated[UUID | None, Query()] = None,
    include_archived: bool = True,
) -> list[ChannelOut]:
    summaries = await use_case.execute()
    if sector_id is not None:
        summaries = [s for s in summaries if s.conversation.sector_id == sector_id]
    if not include_archived:
        summaries = [s for s in summaries if s.conversation.archived_at is None]
    return [ChannelOut.from_summary(s) for s in summaries]


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
async def update_channel(
    channel_id: UUID,
    body: UpdateChannelIn,
    request: Request,
    admin: AdminDep,
    session: SessionDep,
    use_case: UpdateChannelDep,
) -> ChannelOut:
    channel = await use_case.execute(
        UpdateChannelCommand(
            channel_id=channel_id,
            actor_id=admin.id,
            name=body.name,
            archived=body.archived,
            ip=_ip(request),
        )
    )
    members = await SqlAlchemyConversationRepository(session).list_members(channel.id)
    member_count = len([m for m in members if m.left_at is None])
    sector_name = None
    if channel.sector_id is not None:
        sector = await SqlAlchemySectorRepository(session).get_by_id(channel.sector_id)
        sector_name = sector.name if sector else None
    return ChannelOut(
        id=channel.id,
        name=channel.name,
        sector_id=channel.sector_id,
        sector_name=sector_name,
        member_count=member_count,
        archived_at=channel.archived_at.isoformat() if channel.archived_at else None,
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
async def stats(_: AdminDep, session: SessionDep, request: Request) -> StatsOut:
    async def count(model: Any) -> int:
        value = await session.scalar(select(func.count()).select_from(model))
        return int(value or 0)

    storage_root = Path(str(request.app.state.settings.storage_dir))
    storage_bytes, storage_files = _storage_stats(storage_root)
    disk_free, disk_total = _disk_stats(storage_root)

    return StatsOut(
        users=await count(UserRow),
        sectors=await count(SectorRow),
        conversations=await count(ConversationRow),
        messages=await count(MessageRow),
        attachments=await count(AttachmentRow),
        storage_bytes=storage_bytes,
        storage_files=storage_files,
        disk_free_bytes=disk_free,
        disk_total_bytes=disk_total,
    )
