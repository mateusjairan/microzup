from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.core.compat import configure_event_loop
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging
from app.infrastructure.db.session import create_engine, create_session_factory
from app.presentation.api.admin import router as admin_router
from app.presentation.api.auth import me_router
from app.presentation.api.auth import router as auth_router
from app.presentation.api.health import router as health_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = app.state.settings
    engine = create_engine(settings.database_url)
    app.state.engine = engine
    app.state.session_factory = create_session_factory(engine)
    try:
        yield
    finally:
        await engine.dispose()


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
    return app


app = create_app()
