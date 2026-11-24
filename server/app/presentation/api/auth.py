import ipaddress
from urllib.parse import urlsplit

from fastapi import APIRouter, Request, Response, status

from app.application.use_cases.login import LoginCommand
from app.application.use_cases.logout import LogoutCommand
from app.application.use_cases.refresh import RefreshCommand
from app.domain.exceptions import InvalidTokenError
from app.presentation.api.schemas import LoginIn, LoginOut, RefreshOut, UserOut
from app.presentation.deps import CurrentUserDep, LoginDep, LogoutDep, RefreshDep

router = APIRouter(prefix="/auth", tags=["auth"])

# O refresh token nunca é exposto ao JavaScript: sai do corpo da resposta e
# vive num cookie HttpOnly, restrito ao path /auth (só refresh/logout o leem).
REFRESH_COOKIE = "mz_refresh"
# Companheiro não-secreto: preserva a escolha "manter conectado" na rotação,
# senão o primeiro refresh silencioso converteria sessão em cookie de 30 dias.
REMEMBER_COOKIE = "mz_remember"
REFRESH_COOKIE_PATH = "/auth"


def _client_ip(request: Request) -> str | None:
    host = request.client.host if request.client is not None else None
    if host is None:
        return None
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return None
    return host


def _cookie_secure(request: Request) -> bool:
    settings = getattr(request.app.state, "settings", None)
    return bool(settings is not None and settings.cookie_secure)


def _set_refresh_cookie(
    response: Response, request: Request, refresh_token: str, *, remember: bool
) -> None:
    settings = request.app.state.settings
    max_age = settings.refresh_token_ttl_days * 86_400 if remember else None
    for key, value in (
        (REFRESH_COOKIE, refresh_token),
        (REMEMBER_COOKIE, "1" if remember else "0"),
    ):
        response.set_cookie(
            key=key,
            value=value,
            max_age=max_age,
            path=REFRESH_COOKIE_PATH,
            httponly=True,
            secure=_cookie_secure(request),
            samesite="strict",
        )


def _clear_refresh_cookie(response: Response, request: Request) -> None:
    for key in (REFRESH_COOKIE, REMEMBER_COOKIE):
        response.delete_cookie(
            key=key,
            path=REFRESH_COOKIE_PATH,
            httponly=True,
            secure=_cookie_secure(request),
            samesite="strict",
        )


def _remember_requested(request: Request) -> bool:
    """Cai em sessão do navegador se o marcador sumir (fail-safe)."""
    return request.cookies.get(REMEMBER_COOKIE) == "1"


def _read_refresh_cookie(request: Request) -> str:
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise InvalidTokenError("Sessão inválida ou expirada.")
    return token


def _is_cross_origin(request: Request) -> bool:
    """Defesa extra além do SameSite=Strict: recusa Origin de outro host."""
    origin = request.headers.get("origin")
    if origin is None:
        return False
    host = request.headers.get("host")
    if host is None:
        return True
    return urlsplit(origin).netloc != host


def _reject_cross_origin(request: Request) -> None:
    if _is_cross_origin(request):
        raise InvalidTokenError("Origem não permitida.")


@router.post("/login", response_model=LoginOut)
async def login(
    body: LoginIn, request: Request, response: Response, use_case: LoginDep
) -> LoginOut:
    result = await use_case.execute(
        LoginCommand(
            username=body.username,
            password=body.password,
            device_name=body.device_name,
            ip=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    )
    _set_refresh_cookie(response, request, result.refresh_token, remember=body.remember)
    return LoginOut(access_token=result.access_token, user=UserOut.from_user(result.user))


@router.post("/refresh", response_model=RefreshOut)
async def refresh(request: Request, response: Response, use_case: RefreshDep) -> RefreshOut:
    _reject_cross_origin(request)
    result = await use_case.execute(
        RefreshCommand(refresh_token=_read_refresh_cookie(request), ip=_client_ip(request))
    )
    # Rotação: o cookie recebe o novo refresh e o antigo já foi revogado.
    # A escolha "manter conectado" é preservada pelo cookie mz_remember.
    _set_refresh_cookie(
        response, request, result.refresh_token, remember=_remember_requested(request)
    )
    return RefreshOut(access_token=result.access_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, use_case: LogoutDep) -> Response:
    _reject_cross_origin(request)
    token = request.cookies.get(REFRESH_COOKIE)
    if token:
        await use_case.execute(LogoutCommand(refresh_token=token, ip=_client_ip(request)))
    _clear_refresh_cookie(response, request)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


me_router = APIRouter(tags=["auth"])


@me_router.get("/me", response_model=UserOut)
async def me(current: CurrentUserDep) -> UserOut:
    return UserOut.from_user(current)
