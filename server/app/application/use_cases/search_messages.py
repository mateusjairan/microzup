from app.application.dto import SearchMessagesCommand, SearchMessagesResult
from app.domain.policies.conversation_access import ConversationAccessPolicy
from app.domain.ports.repositories import (
    AttachmentRepository,
    ConversationRepository,
    MessageRepository,
)

__all__ = ["SearchMessages", "SearchMessagesCommand", "SearchMessagesResult"]


class SearchMessages:
    """Busca full-text em mensagens + nome de arquivo (plano §5/§6).

    - Mensagens: `websearch_to_tsquery('portuguese', q)` ranqueado por
      `ts_rank_cd`, restrito às conversas do usuário (regra do plano §2.9).
    - Arquivos: índice trigram (`pg_trgm`) sobre `attachments.filename`.
    - `conversation_id` revalida acesso com a mesma policy de leitura.
    """

    def __init__(
        self,
        messages: MessageRepository,
        attachments: AttachmentRepository,
        conversations: ConversationRepository,
        policy: ConversationAccessPolicy,
    ) -> None:
        self._messages = messages
        self._attachments = attachments
        self._conversations = conversations
        self._policy = policy

    async def execute(self, command: SearchMessagesCommand) -> SearchMessagesResult:
        query = command.query.strip()
        if not query:
            return SearchMessagesResult(messages=[], files=[])

        conversation_id = command.conversation_id
        if conversation_id is not None:
            # Revalidação de acesso no servidor (plano §7.7): o filtro só
            # aceita conversas das quais o usuário é membro.
            member = await self._conversations.get_member(conversation_id, command.user_id)
            self._policy.ensure_can_read(member)

        messages = await self._messages.search(
            command.user_id, query, conversation_id, command.limit
        )
        files = await self._attachments.search_by_filename(
            command.user_id, query, conversation_id, command.limit
        )
        return SearchMessagesResult(messages=messages, files=files)
