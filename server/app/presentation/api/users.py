from typing import cast

from fastapi import APIRouter, Request

from app.infrastructure.db.repositories.users import SqlAlchemyUserRepository
from app.presentation.api.schemas import DirectoryUserOut
from app.presentation.deps import CurrentUserDep, SessionDep
from app.presentation.ws.hub import WebSocketHub

router = APIRouter(tags=["users"])


@router.get("/users", response_model=list[DirectoryUserOut])
async def list_users(
    _: CurrentUserDep, session: SessionDep, request: Request
) -> list[DirectoryUserOut]:
    hub = cast(WebSocketHub, request.app.state.hub)
    users = await SqlAlchemyUserRepository(session).list_active()
    return [DirectoryUserOut.from_user_and_presence(user, hub.status_of(user.id)) for user in users]
