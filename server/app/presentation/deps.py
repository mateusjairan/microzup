from collections.abc import AsyncIterator
from typing import Annotated, cast
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.use_cases.create_sector import CreateSector
from app.application.use_cases.create_user import CreateUser
from app.application.use_cases.login import Login
from app.application.use_cases.logout import Logout
from app.application.use_cases.refresh import Refresh
from app.application.use_cases.update_user import UpdateUser
from app.config import Settings
from app.domain.entities.user import User
from app.infrastructure.clock import SystemClock
from app.infrastructure.db.repositories.audit import SqlAlchemyAuditSink
from app.infrastructure.db.repositories.sectors import SqlAlchemySectorRepository
from app.infrastructure.db.repositories.sessions import SqlAlchemySessionRepository
from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
from app.infrastructure.db.uow import SqlAlchemyUnitOfWork
from app.infrastructure.security import (
    Argon2Hasher,
    JwtAccessTokenIssuer,
    Sha256RefreshTokenIssuer,
)

_bearer = HTTPBearer(auto_error=False)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    factory = cast(async_sessionmaker[AsyncSession], request.app.state.session_factory)
    async with factory() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def _access_issuer(request: Request) -> JwtAccessTokenIssuer:
    settings = _settings(request)
    return JwtAccessTokenIssuer(
        settings.jwt_secret, settings.access_token_ttl_minutes, SystemClock()
    )


def get_create_sector(session: SessionDep) -> CreateSector:
    return CreateSector(
        sectors=SqlAlchemySectorRepository(session),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


CreateSectorDep = Annotated[CreateSector, Depends(get_create_sector)]


def get_create_user(request: Request, session: SessionDep) -> CreateUser:
    return CreateUser(
        users=SqlAlchemyUserRepository(session),
        sectors=SqlAlchemySectorRepository(session),
        hasher=Argon2Hasher(),
        audit=SqlAlchemyAuditSink(session),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


CreateUserDep = Annotated[CreateUser, Depends(get_create_user)]


def get_login(request: Request, session: SessionDep) -> Login:
    return Login(
        users=SqlAlchemyUserRepository(session),
        sessions=SqlAlchemySessionRepository(session),
        hasher=Argon2Hasher(),
        access_tokens=_access_issuer(request),
        refresh_tokens=Sha256RefreshTokenIssuer(),
        audit=SqlAlchemyAuditSink(session),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


LoginDep = Annotated[Login, Depends(get_login)]


def get_refresh(request: Request, session: SessionDep) -> Refresh:
    return Refresh(
        users=SqlAlchemyUserRepository(session),
        sessions=SqlAlchemySessionRepository(session),
        access_tokens=_access_issuer(request),
        refresh_tokens=Sha256RefreshTokenIssuer(),
        audit=SqlAlchemyAuditSink(session),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


RefreshDep = Annotated[Refresh, Depends(get_refresh)]


def get_logout(session: SessionDep) -> Logout:
    return Logout(
        sessions=SqlAlchemySessionRepository(session),
        refresh_tokens=Sha256RefreshTokenIssuer(),
        audit=SqlAlchemyAuditSink(session),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


LogoutDep = Annotated[Logout, Depends(get_logout)]


def get_update_user(session: SessionDep) -> UpdateUser:
    return UpdateUser(
        users=SqlAlchemyUserRepository(session),
        audit=SqlAlchemyAuditSink(session),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


UpdateUserDep = Annotated[UpdateUser, Depends(get_update_user)]


async def get_current_user(
    request: Request,
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        user_id: UUID = _access_issuer(request).decode(credentials.credentials)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = await SqlAlchemyUserRepository(session).get_by_id(user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user unavailable",
        )
    return user


CurrentUserDep = Annotated[User, Depends(get_current_user)]


async def get_current_admin(current: CurrentUserDep) -> User:
    if current.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin required")
    return current


AdminDep = Annotated[User, Depends(get_current_admin)]
