import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import __version__
from app.application.use_cases.retention import RetentionRunCommand, RunRetention
from app.config import Settings, get_settings
from app.core.compat import configure_event_loop
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging
from app.domain.policies.retention import RetentionPolicy
from app.infrastructure.clock import SystemClock
from app.infrastructure.db.repositories.attachments import SqlAlchemyAttachmentRepository
from app.infrastructure.db.repositories.messages import SqlAlchemyMessageRepository
from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
from app.infrastructure.db.session import create_engine, create_session_factory
from app.infrastructure.db.uow import SqlAlchemyUnitOfWork
from app.infrastructure.events import InMemoryEventBus
from app.infrastructure.rate_limit import InMemoryRateLimiter, LoginAttemptTracker
from app.infrastructure.storage import LocalDiskStorage
from app.presentation.api.admin import router as admin_router
from app.presentation.api.auth import me_router
from app.presentation.api.auth import router as auth_router
from app.presentation.api.conversations import router as conversations_router
from app.presentation.api.files import router as files_router
from app.presentation.api.health import router as health_router
from app.presentation.api.messages import router as messages_router
from app.presentation.api.sectors import router as sectors_router
from app.presentation.api.users import router as users_router
from app.presentation.api.ws import router as ws_router
from app.presentation.subscribers import AuditSubscriber
from app.presentation.ws.hub import WebSocketHub

_log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = app.state.settings
    engine = create_engine(
        settings.database_url,
        statement_timeout_ms=settings.statement_timeout_ms,
        idle_in_transaction_session_timeout_ms=settings.idle_in_transaction_session_timeout_ms,
    )
    app.state.engine = engine
    session_factory = create_session_factory(engine)
    app.state.session_factory = session_factory

    event_bus = InMemoryEventBus()
    hub = WebSocketHub()
    event_bus.subscribe(hub.on_event)
    # Auditoria via EventBus (plano §4.2): o subscriber grava o audit_log
    # reagindo a AuditRequested — fora da transação do caso de uso.
    event_bus.subscribe(AuditSubscriber(session_factory).on_event)
    app.state.event_bus = event_bus
    app.state.hub = hub
    app.state.ws_tickets = {}

    # Limites em memória: 1 processo Uvicorn (plano §8).
    app.state.rate_limiter = InMemoryRateLimiter()
    app.state.login_attempts = LoginAttemptTracker(
        max_attempts=settings.login_max_attempts,
        base_lockout_seconds=float(settings.login_lockout_seconds),
    )
    app.state.nudge_throttle = InMemoryRateLimiter()

    storage = LocalDiskStorage(settings.storage_dir)
    app.state.storage = storage
    cleanup_task = asyncio.create_task(_orphan_cleanup_loop(settings, session_factory, storage))

    retention_task: asyncio.Task[None] | None = None
    retention_policy = RetentionPolicy(
        message_retention_days=settings.message_retention_days,
        file_retention_days=settings.file_retention_days,
    )
    if retention_policy.enabled and settings.retention_interval_seconds > 0:
        retention_task = asyncio.create_task(
            _retention_loop(settings, session_factory, storage, retention_policy, event_bus)
        )

    # Plano §8: WARNING no boot enquanto não houver admin ativo.
    try:
        async with session_factory() as session:
            has_admin = await SqlAlchemyUserRepository(session).exists_active_admin()
        if not has_admin:
            _log.warning(
                "boot_without_active_admin",
                hint="crie um admin com: uv run python -m app.cli create-admin --username admin",
            )
    except Exception:
        _log.warning("boot_admin_check_failed")

    try:
        yield
    finally:
        cleanup_task.cancel()
        if retention_task is not None:
            retention_task.cancel()
        await engine.dispose()


async def _orphan_cleanup_loop(
    settings: Settings,
    session_factory: async_sessionmaker[AsyncSession],
    storage: LocalDiskStorage,
) -> None:
    logger = structlog.get_logger()
    while True:
        await asyncio.sleep(3600)
        try:
            async with session_factory() as session:
                repo = SqlAlchemyAttachmentRepository(session)
                cutoff = datetime.now(UTC) - timedelta(hours=settings.orphan_attachment_ttl_hours)
                orphans = await repo.list_orphans_older_than(cutoff)
                for orphan in orphans:
                    storage.delete(orphan.storage_path)
                    if orphan.thumbnail_path is not None:
                        storage.delete(orphan.thumbnail_path)
                    await repo.delete(orphan)
                await session.commit()
        except Exception:
            logger.exception("orphan_cleanup_failed")


async def _retention_loop(
    settings: Settings,
    session_factory: async_sessionmaker[AsyncSession],
    storage: LocalDiskStorage,
    policy: RetentionPolicy,
    event_bus: InMemoryEventBus,
) -> None:
    """Retenção opcional (plano §8): um lote por intervalo, auditoriado como *.purge.

    Executa também como CLI (`app.cli retention-run`) para operação explícita;
    esta task mantém o servidor autônomo quando a retenção está configurada.
    """
    logger = structlog.get_logger()
    while True:
        await asyncio.sleep(settings.retention_interval_seconds)
        try:
            async with session_factory() as session:
                use_case = RunRetention(
                    messages=SqlAlchemyMessageRepository(session),
                    attachments=SqlAlchemyAttachmentRepository(session),
                    storage=storage,
                    policy=policy,
                    events=event_bus,
                    uow=SqlAlchemyUnitOfWork(session),
                    clock=SystemClock(),
                )
                result = await use_case.execute(RetentionRunCommand())
                if result.messages_purged or result.files_purged:
                    logger.info(
                        "retention_run",
                        messages_purged=result.messages_purged,
                        files_purged=result.files_purged,
                    )
        except Exception:
            logger.exception("retention_run_failed")


def create_app() -> FastAPI:
    configure_event_loop()
    settings = get_settings()
    # APP_ENV=test não cria arquivo de log: stdout JSON apenas (rotação diária em produção).
    log_dir = None if settings.app_env == "test" else settings.log_dir
    configure_logging(settings.log_level, log_dir, settings.log_retention_days)

    app = FastAPI(title="Microzup API", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.version = __version__

    # Mesma origem por padrão (o SPA é servido por esta API): sem CORS.
    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    install_error_handlers(app)
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(me_router)
    app.include_router(admin_router)
    app.include_router(sectors_router)
    app.include_router(users_router)
    app.include_router(conversations_router)
    app.include_router(messages_router)
    app.include_router(files_router)
    app.include_router(ws_router)

    _install_security_headers(app)
    _mount_web_app(app, settings.web_dist_path())
    return app


# CSP compatível com o SPA (sem origem remota, sem CDN): scripts só do próprio
# host; estilos inline são necessários para os atributos `style` do Radix.
CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    "connect-src 'self' ws: wss:; "
    "media-src 'self' blob:; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


def _install_security_headers(app: FastAPI) -> None:
    @app.middleware("http")
    async def security_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers.setdefault("Content-Security-Policy", CSP)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response


def _mount_web_app(app: FastAPI, dist: Path) -> None:
    """Serve o build do SPA em `/` — um único processo/porta na LAN."""
    if not (dist / "index.html").is_file():
        _log.warning("web_build_missing", path=str(dist), hint="rode `npm run build` em web/")
        return
    app.mount("/", StaticFiles(directory=dist, html=True), name="web")


app = create_app()
