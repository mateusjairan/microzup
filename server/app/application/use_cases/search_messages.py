from dataclasses import dataclass
from uuid import UUID

from app.domain.entities.message import Message
from app.domain.ports.repositories import MessageRepository


@dataclass(frozen=True, slots=True)
class SearchMessagesCommand:
    user_id: UUID
    query: str
    limit: int = 30


class SearchMessages:
    def __init__(self, messages: MessageRepository) -> None:
        self._messages = messages

    async def execute(self, command: SearchMessagesCommand) -> list[Message]:
        if not command.query.strip():
            return []
        return await self._messages.search(command.user_id, command.query.strip(), command.limit)
