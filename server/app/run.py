import uvicorn

from app.core.compat import configure_event_loop
from app.main import app


def main() -> None:
    configure_event_loop()
    from app.config import get_settings

    settings = get_settings()
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()
