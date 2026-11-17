from app.domain.entities.conversation import ConversationMember
from app.domain.exceptions import AccessDeniedError


class ConversationAccessPolicy:
    def ensure_can_read(self, member: ConversationMember | None) -> None:
        if member is None or member.left_at is not None:
            raise AccessDeniedError("Você não participa desta conversa.")

    def ensure_can_write(self, member: ConversationMember | None) -> None:
        self.ensure_can_read(member)
