import logging
import sys
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

import structlog

_FORMAT = "%(message)s"


def _build_handlers(log_dir: Path | None, retention_days: int) -> list[logging.Handler]:
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
    if log_dir is not None:
        log_dir.mkdir(parents=True, exist_ok=True)
        # Rotação diária à meia-noite (plano §8); JSON estruturado em stdout E arquivo.
        handlers.append(
            TimedRotatingFileHandler(
                log_dir / "server.log",
                when="midnight",
                backupCount=max(1, retention_days),
                encoding="utf-8",
            )
        )
    return handlers


def configure_logging(level: str, log_dir: Path | None = None, retention_days: int = 14) -> None:
    numeric_level = getattr(logging, level.upper(), logging.INFO)

    root = logging.getLogger()
    root.setLevel(numeric_level)
    # Idempotente: reaplica os handlers (create_app roda a cada teste).
    for handler in list(root.handlers):
        root.removeHandler(handler)
        handler.close()
    for handler in _build_handlers(log_dir, retention_days):
        handler.setFormatter(logging.Formatter(_FORMAT))
        root.addHandler(handler)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(numeric_level),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
