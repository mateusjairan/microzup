from collections.abc import AsyncIterator
from typing import Annotated, cast

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.use_cases.create_sector import CreateSector
from app.infrastructure.clock import SystemClock
from app.infrastructure.db.repositories.sectors import SqlAlchemySectorRepository
from app.infrastructure.db.uow import SqlAlchemyUnitOfWork


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    factory = cast(async_sessionmaker[AsyncSession], request.app.state.session_factory)
    async with factory() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_create_sector(session: SessionDep) -> CreateSector:
    return CreateSector(
        sectors=SqlAlchemySectorRepository(session),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


CreateSectorDep = Annotated[CreateSector, Depends(get_create_sector)]
