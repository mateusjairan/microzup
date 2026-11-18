from app.application.dto import WsHelloCommand, WsHelloResult
from app.domain.exceptions import NotFoundError
from app.domain.ports.repositories import ConversationRepository, UserRepository

__all__ = ["BuildWsHello", "WsHelloCommand", "WsHelloResult"]


class BuildWsHello:
    """Monta o snapshot inicial do WebSocket: usuário e suas inscrições (conversas)."""

    def __init__(
        self,
        users: UserRepository,
        conversations: ConversationRepository,
    ) -> None:
        self._users = users
        self._conversations = conversations

    async def execute(self, command: WsHelloCommand) -> WsHelloResult:
        user = await self._users.get_by_id(command.user_id)
        if user is None:
            raise NotFoundError("Usuário não encontrado.")
        subscribed = await self._conversations.list_for_user(command.user_id)
        return WsHelloResult(user=user, conversation_ids=frozenset(c.id for c in subscribed))
