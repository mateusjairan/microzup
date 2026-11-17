import ipaddress

from fastapi import APIRouter, Request, Response, status

from app.application.use_cases.login import LoginCommand
from app.application.use_cases.logout import LogoutCommand
from app.application.use_cases.refresh import RefreshCommand
from app.presentation.api.schemas import LoginIn, LoginOut, RefreshIn, RefreshOut, UserOut
from app.presentation.deps import CurrentUserDep, LoginDep, LogoutDep, RefreshDep

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str | None:
    host = request.client.host if request.client is not None else None
    if host is None:
        return None
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return None
    return host


@router.post("/login", response_model=LoginOut)
async def login(body: LoginIn, request: Request, use_case: LoginDep) -> LoginOut:
    result = await use_case.execute(
        LoginCommand(
            username=body.username,
            password=body.password,
            device_name=body.device_name,
            ip=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    )
    return LoginOut(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        user=UserOut.from_user(result.user),
    )


@router.post("/refresh", response_model=RefreshOut)
async def refresh(body: RefreshIn, request: Request, use_case: RefreshDep) -> RefreshOut:
    result = await use_case.execute(
        RefreshCommand(refresh_token=body.refresh_token, ip=_client_ip(request))
    )
    return RefreshOut(access_token=result.access_token, refresh_token=result.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshIn, request: Request, use_case: LogoutDep) -> Response:
    await use_case.execute(LogoutCommand(refresh_token=body.refresh_token, ip=_client_ip(request)))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


me_router = APIRouter(tags=["auth"])


@me_router.get("/me", response_model=UserOut)
async def me(current: CurrentUserDep) -> UserOut:
    return UserOut.from_user(current)
