import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.domain.exceptions import (
    AccessDeniedError,
    AuthenticationError,
    ConflictError,
    DomainError,
    InactiveUserError,
    InvalidTokenError,
    NotFoundError,
    RateLimitedError,
    TooManyAttemptsError,
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
    (RateLimitedError, 429),
    (TooManyAttemptsError, 429),
)

_log = structlog.get_logger()

_FALLBACK_CODE_BY_STATUS: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "rate_limited",
}


def _status_code_name(status_code: int) -> str:
    return _FALLBACK_CODE_BY_STATUS.get(status_code, f"http_{status_code}")


def error_body(
    code: str, message: str, details: dict[str, object] | None = None
) -> dict[str, object]:
    """Envelope único de erro do contrato (plano §7): {"error": {code, message, details}}."""
    return {"error": {"code": code, "message": message, "details": details or {}}}


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
            content=error_body(exc.code, str(exc)),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # Inclui os 401/403 levantados nas dependências (admin required etc.).
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(_status_code_name(exc.status_code), str(exc.detail)),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = [
            {
                "loc": [str(part) for part in error["loc"]],
                "msg": error["msg"],
                "type": error["type"],
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=error_body("validation_error", "Dados inválidos.", {"errors": errors}),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        # Sem detalhe interno no corpo; o stack fica só no log estruturado.
        _log.exception("unhandled_error", path=request.url.path)
        return JSONResponse(
            status_code=500,
            content=error_body("internal_error", "Erro interno do servidor."),
        )
