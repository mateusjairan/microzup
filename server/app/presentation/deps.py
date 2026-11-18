from collections.abc import AsyncIterator
from typing import Annotated, cast
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.audit import apply_audit
from app.application.idempotency import apply_idempotency
from app.application.rate_limit import apply_rate_limit
from app.application.use_cases.conversations import (
    ListChannels,
    ListConversationMembers,
    ListConversations,
    OpenDirectMessage,
    UpdateChannel,
)
from app.application.use_cases.create_sector import CreateSector
from app.application.use_cases.create_user import CreateUser
from app.application.use_cases.download_file import DownloadFile
from app.application.use_cases.login import Login
from app.application.use_cases.logout import Logout
from app.application.use_cases.messages import (
    DeleteMessage,
    EditMessage,
    ListMessages,
    MarkRead,
    SendMessage,
)
from app.application.use_cases.refresh import Refresh
from app.application.use_cases.reset_password import ResetPassword
from app.application.use_cases.search_messages import SearchMessages
from app.application.use_cases.update_sector import UpdateSector
from app.application.use_cases.update_user import UpdateUser
from app.application.use_cases.upload_file import UploadFile
from app.config import Settings
from app.domain.entities.user import User
from app.domain.policies.conversation_access import ConversationAccessPolicy
from app.domain.ports.events import EventBus
from app.domain.ports.throttling import RateLimiter
from app.infrastructure.clock import SystemClock
from app.infrastructure.db.repositories.attachments import SqlAlchemyAttachmentRepository
from app.infrastructure.db.repositories.conversations import SqlAlchemyConversationRepository
from app.infrastructure.db.repositories.message_reads import SqlAlchemyMessageReadRepository
from app.infrastructure.db.repositories.messages import SqlAlchemyMessageRepository
from app.infrastructure.db.repositories.sectors import SqlAlchemySectorRepository
from app.infrastructure.db.repositories.sessions import SqlAlchemySessionRepository
from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
from app.infrastructure.db.uow import SqlAlchemyUnitOfWork
from app.infrastructure.media import LibmagicMimeSniffer, PillowImageThumbnailer
from app.infrastructure.rate_limit import LoginAttemptTracker
from app.infrastructure.security import (
    Argon2Hasher,
    JwtAccessTokenIssuer,
    Sha256RefreshTokenIssuer,
)
from app.infrastructure.storage import LocalDiskStorage
from app.presentation.ws.hub import WebSocketHub

_bearer = HTTPBearer(auto_error=False)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    factory = cast(async_sessionmaker[AsyncSession], request.app.state.session_factory)
    async with factory() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def _rate_limiter(request: Request) -> RateLimiter:
    return cast(RateLimiter, request.app.state.rate_limiter)


def _login_attempts(request: Request) -> LoginAttemptTracker:
    return cast(LoginAttemptTracker, request.app.state.login_attempts)


def _access_issuer(request: Request) -> JwtAccessTokenIssuer:
    settings = _settings(request)
    return JwtAccessTokenIssuer(
        settings.jwt_secret, settings.access_token_ttl_minutes, SystemClock()
    )


def _bus(request: Request) -> EventBus:
    return cast(EventBus, request.app.state.event_bus)


def _hub(request: Request) -> WebSocketHub:
    return cast(WebSocketHub, request.app.state.hub)


def _storage(request: Request) -> LocalDiskStorage:
    return LocalDiskStorage(_settings(request).storage_dir)


def get_create_sector(request: Request, session: SessionDep) -> CreateSector:
    use_case = CreateSector(
        sectors=SqlAlchemySectorRepository(session),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
        conversations=SqlAlchemyConversationRepository(session),
    )
    # Auditoria por composição (plano §4.2: decorator `@audit` na borda de DI).
    apply_audit(
        use_case,
        _bus(request),
        action="sector.create",
        entity_type="sector",
        entity_id=lambda cmd, result: str(result.id),
        actor=lambda cmd: cmd.actor_id,
        metadata=lambda cmd, result: {"name": result.name, "slug": result.slug},
        ip=lambda cmd: cmd.ip,
    )
    return use_case


CreateSectorDep = Annotated[CreateSector, Depends(get_create_sector)]


def get_create_user(request: Request, session: SessionDep) -> CreateUser:
    use_case = CreateUser(
        users=SqlAlchemyUserRepository(session),
        sectors=SqlAlchemySectorRepository(session),
        hasher=Argon2Hasher(),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
        conversations=SqlAlchemyConversationRepository(session),
    )
    apply_audit(
        use_case,
        _bus(request),
        # Bootstrap via CLI audita como user.bootstrap (plano §8).
        action=lambda cmd: cmd.audit_action,
        entity_type="user",
        entity_id=lambda cmd, result: str(result.id),
        actor=lambda cmd: cmd.actor_id,
        metadata=lambda cmd, result: {"username": result.username, "role": result.role},
        ip=lambda cmd: cmd.ip,
    )
    return use_case


CreateUserDep = Annotated[CreateUser, Depends(get_create_user)]


def get_login(request: Request, session: SessionDep) -> Login:
    settings = _settings(request)
    use_case = Login(
        users=SqlAlchemyUserRepository(session),
        sessions=SqlAlchemySessionRepository(session),
        hasher=Argon2Hasher(),
        access_tokens=_access_issuer(request),
        refresh_tokens=Sha256RefreshTokenIssuer(),
        events=_bus(request),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
        attempts=_login_attempts(request),
    )
    # Rate limit por IP na borda de login (o bloqueio por IP+usuário é no caso de uso).
    apply_rate_limit(
        use_case,
        _rate_limiter(request),
        scope="login",
        limit=settings.rate_limit_login_per_minute,
        window_seconds=60.0,
        key=lambda cmd: cmd.ip or "unknown",
        message="Muitas tentativas de login. Aguarde um minuto e tente de novo.",
    )
    return use_case


LoginDep = Annotated[Login, Depends(get_login)]


def get_refresh(request: Request, session: SessionDep) -> Refresh:
    return Refresh(
        users=SqlAlchemyUserRepository(session),
        sessions=SqlAlchemySessionRepository(session),
        access_tokens=_access_issuer(request),
        refresh_tokens=Sha256RefreshTokenIssuer(),
        events=_bus(request),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


RefreshDep = Annotated[Refresh, Depends(get_refresh)]


def get_logout(request: Request, session: SessionDep) -> Logout:
    return Logout(
        sessions=SqlAlchemySessionRepository(session),
        refresh_tokens=Sha256RefreshTokenIssuer(),
        events=_bus(request),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


LogoutDep = Annotated[Logout, Depends(get_logout)]


def get_update_user(request: Request, session: SessionDep) -> UpdateUser:
    return UpdateUser(
        users=SqlAlchemyUserRepository(session),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
        events=_bus(request),
        sectors=SqlAlchemySectorRepository(session),
        conversations=SqlAlchemyConversationRepository(session),
        sessions=SqlAlchemySessionRepository(session),
    )


UpdateUserDep = Annotated[UpdateUser, Depends(get_update_user)]


def get_update_sector(request: Request, session: SessionDep) -> UpdateSector:
    use_case = UpdateSector(
        sectors=SqlAlchemySectorRepository(session),
        conversations=SqlAlchemyConversationRepository(session),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )
    apply_audit(
        use_case,
        _bus(request),
        action="sector.update",
        entity_type="sector",
        entity_id=lambda cmd, result: str(cmd.target_id),
        actor=lambda cmd: cmd.actor_id,
        metadata=lambda cmd, result: {"name": result.name, "description": result.description},
        ip=lambda cmd: cmd.ip,
    )
    return use_case


UpdateSectorDep = Annotated[UpdateSector, Depends(get_update_sector)]


def get_reset_password(request: Request, session: SessionDep) -> ResetPassword:
    return ResetPassword(
        users=SqlAlchemyUserRepository(session),
        sessions=SqlAlchemySessionRepository(session),
        hasher=Argon2Hasher(),
        events=_bus(request),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


ResetPasswordDep = Annotated[ResetPassword, Depends(get_reset_password)]


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


def get_send_message(request: Request, session: SessionDep) -> SendMessage:
    settings = _settings(request)
    use_case = SendMessage(
        conversations=SqlAlchemyConversationRepository(session),
        messages=SqlAlchemyMessageRepository(session),
        attachments=SqlAlchemyAttachmentRepository(session),
        policy=ConversationAccessPolicy(),
        events=_bus(request),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
        max_chars=settings.message_max_chars,
        max_attachments=settings.max_attachments_per_message,
    )
    # Idempotência por composição (plano §4.2): retry com (conversation_id,
    # client_id) repetido devolve a mensagem original sem reexecutar a regra.
    apply_idempotency(
        use_case,
        lambda cmd: SqlAlchemyMessageRepository(session).get_by_client_id(
            cmd.conversation_id, cmd.client_id
        ),
    )
    apply_rate_limit(
        use_case,
        _rate_limiter(request),
        scope="message",
        limit=settings.rate_limit_message_per_minute,
        window_seconds=60.0,
        key=lambda cmd: str(cmd.sender_id),
    )
    return use_case


SendMessageDep = Annotated[SendMessage, Depends(get_send_message)]


def get_edit_message(request: Request, session: SessionDep) -> EditMessage:
    return EditMessage(
        conversations=SqlAlchemyConversationRepository(session),
        messages=SqlAlchemyMessageRepository(session),
        events=_bus(request),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
        max_chars=_settings(request).message_max_chars,
    )


EditMessageDep = Annotated[EditMessage, Depends(get_edit_message)]


def get_delete_message(request: Request, session: SessionDep) -> DeleteMessage:
    return DeleteMessage(
        conversations=SqlAlchemyConversationRepository(session),
        messages=SqlAlchemyMessageRepository(session),
        events=_bus(request),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


DeleteMessageDep = Annotated[DeleteMessage, Depends(get_delete_message)]


def get_mark_read(request: Request, session: SessionDep) -> MarkRead:
    return MarkRead(
        conversations=SqlAlchemyConversationRepository(session),
        reads=SqlAlchemyMessageReadRepository(session),
        policy=ConversationAccessPolicy(),
        uow=SqlAlchemyUnitOfWork(session),
        events=_bus(request),
    )


MarkReadDep = Annotated[MarkRead, Depends(get_mark_read)]


def get_list_messages(session: SessionDep) -> ListMessages:
    return ListMessages(
        conversations=SqlAlchemyConversationRepository(session),
        messages=SqlAlchemyMessageRepository(session),
        policy=ConversationAccessPolicy(),
    )


ListMessagesDep = Annotated[ListMessages, Depends(get_list_messages)]


def get_open_dm(session: SessionDep) -> OpenDirectMessage:
    return OpenDirectMessage(
        conversations=SqlAlchemyConversationRepository(session),
        users=SqlAlchemyUserRepository(session),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


OpenDmDep = Annotated[OpenDirectMessage, Depends(get_open_dm)]


def get_list_conversations(session: SessionDep) -> ListConversations:
    return ListConversations(
        conversations=SqlAlchemyConversationRepository(session),
        messages=SqlAlchemyMessageRepository(session),
        reads=SqlAlchemyMessageReadRepository(session),
        users=SqlAlchemyUserRepository(session),
    )


ListConversationsDep = Annotated[ListConversations, Depends(get_list_conversations)]


def get_list_conversation_members(request: Request, session: SessionDep) -> ListConversationMembers:
    return ListConversationMembers(
        conversations=SqlAlchemyConversationRepository(session),
        users=SqlAlchemyUserRepository(session),
        policy=ConversationAccessPolicy(),
        presence=_hub(request),
    )


ListConversationMembersDep = Annotated[
    ListConversationMembers, Depends(get_list_conversation_members)
]


def get_list_channels(session: SessionDep) -> ListChannels:
    return ListChannels(
        conversations=SqlAlchemyConversationRepository(session),
        sectors=SqlAlchemySectorRepository(session),
    )


ListChannelsDep = Annotated[ListChannels, Depends(get_list_channels)]


def get_update_channel(request: Request, session: SessionDep) -> UpdateChannel:
    return UpdateChannel(
        conversations=SqlAlchemyConversationRepository(session),
        events=_bus(request),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
    )


UpdateChannelDep = Annotated[UpdateChannel, Depends(get_update_channel)]


def get_upload_file(request: Request, session: SessionDep) -> UploadFile:
    settings = _settings(request)
    use_case = UploadFile(
        attachments=SqlAlchemyAttachmentRepository(session),
        storage=_storage(request),
        uow=SqlAlchemyUnitOfWork(session),
        clock=SystemClock(),
        sniffer=LibmagicMimeSniffer(),
        thumbnailer=PillowImageThumbnailer(),
        events=_bus(request),
    )
    apply_rate_limit(
        use_case,
        _rate_limiter(request),
        scope="upload",
        limit=settings.rate_limit_upload_per_minute,
        window_seconds=60.0,
        key=lambda cmd: str(cmd.uploader_id),
    )
    return use_case


UploadFileDep = Annotated[UploadFile, Depends(get_upload_file)]


def get_download_file(request: Request, session: SessionDep) -> DownloadFile:
    return DownloadFile(
        attachments=SqlAlchemyAttachmentRepository(session),
        messages=SqlAlchemyMessageRepository(session),
        conversations=SqlAlchemyConversationRepository(session),
        policy=ConversationAccessPolicy(),
        storage=_storage(request),
        events=_bus(request),
    )


DownloadFileDep = Annotated[DownloadFile, Depends(get_download_file)]


def get_search_messages(session: SessionDep) -> SearchMessages:
    return SearchMessages(
        messages=SqlAlchemyMessageRepository(session),
        attachments=SqlAlchemyAttachmentRepository(session),
        conversations=SqlAlchemyConversationRepository(session),
        policy=ConversationAccessPolicy(),
    )


SearchMessagesDep = Annotated[SearchMessages, Depends(get_search_messages)]
