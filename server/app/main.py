import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings, get_settings
from app.core.compat import configure_event_loop
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging
from app.infrastructure.db.repositories.attachments import SqlAlchemyAttachmentRepository
from app.infrastructure.db.session import create_engine, create_session_factory
from app.infrastructure.events import InMemoryEventBus
from app.infrastructure.storage import LocalDiskStorage
from app.presentation.api.admin import router as admin_router
from app.presentation.api.auth import me_router
from app.presentation.api.auth import router as auth_router
from app.presentation.api.conversations import router as conversations_router
from app.presentation.api.files import router as files_router
from app.presentation.api.health import router as health_router
from app.presentation.api.messages import router as messages_router
from app.presentation.api.ws import router as ws_router
from app.presentation.ws.hub import WebSocketHub


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = app.state.settings
    engine = create_engine(settings.database_url)
    app.state.engine = engine
    session_factory = create_session_factory(engine)
    app.state.session_factory = session_factory

    event_bus = InMemoryEventBus()
    hub = WebSocketHub()
    event_bus.subscribe(hub.on_event)
    app.state.event_bus = event_bus
    app.state.hub = hub
    app.state.ws_tickets = {}

    storage = LocalDiskStorage(settings.storage_dir)
    app.state.storage = storage
    cleanup_task = asyncio.create_task(_orphan_cleanup_loop(settings, session_factory, storage))

    try:
        yield
    finally:
        cleanup_task.cancel()
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
                    await repo.delete(orphan)
                await session.commit()
        except Exception:
            logger.exception("orphan_cleanup_failed")


def create_app() -> FastAPI:
    configure_event_loop()
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(title="Microzup API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings

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
    app.include_router(conversations_router)
    app.include_router(messages_router)
    app.include_router(files_router)
    app.include_router(ws_router)
    return app


app = create_app()
