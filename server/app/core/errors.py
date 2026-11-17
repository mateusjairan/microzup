import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.domain.exceptions import (
    AccessDeniedError,
    AuthenticationError,
    ConflictError,
    DomainError,
    InactiveUserError,
    InvalidTokenError,
    NotFoundError,
    ValidationError,
)

_STATUS_BY_ERROR: tuple[tuple[type[DomainError], int], ...] = (
    (ValidationError, 422),
    (AuthenticationError, 401),
    (InvalidTokenError, 401),
    (AccessDeniedError, 403),
    (InactiveUserError, 403),
    (NotFoundError, 404),
    (ConflictError, 409),
)

_log = structlog.get_logger()


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
        status_code = next(
            (code for error_type, code in _STATUS_BY_ERROR if isinstance(exc, error_type)),
            400,
        )
        _log.info(
            "domain_error",
            code=exc.code,
            status=status_code,
            path=request.url.path,
        )
        return JSONResponse(
            status_code=status_code,
            content={"error": {"code": exc.code, "message": str(exc), "details": {}}},
        )
