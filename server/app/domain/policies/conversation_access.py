from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.exceptions import AccessDeniedError


class ConversationAccessPolicy:
    def ensure_can_read(self, member: ConversationMember | None) -> None:
        if member is None or member.left_at is not None:
            raise AccessDeniedError("Você não participa desta conversa.")

    def ensure_can_write(
        self, member: ConversationMember | None, conversation: Conversation | None = None
    ) -> None:
        self.ensure_can_read(member)
        # Canal arquivado vira somente leitura: o histórico permanece, o composer não.
        if conversation is not None and conversation.archived_at is not None:
            raise AccessDeniedError("Esta conversa está arquivada e não aceita novas mensagens.")
