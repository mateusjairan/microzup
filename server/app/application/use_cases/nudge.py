"""Caso de uso "chamar atenção" (nudge) — plano-frontend §8.4.

Regras: 1 nudge por conversa a cada 5 min por remetente; entrega apenas a
membros online que não estejam em `dnd` (invisible aparece offline e não recebe);
auditoria via EventBus (`message.nudge` publicada como AuditRequested).
"""

from app.application.dto import NudgeCommand, NudgeResult
from app.application.events import AuditRequested, NudgeSent
from app.domain.exceptions import AccessDeniedError, NotFoundError
from app.domain.ports.events import EventBus
from app.domain.ports.presence import PresenceDirectory
from app.domain.ports.repositories import ConversationRepository, UserRepository
from app.domain.ports.throttling import RateLimiter

__all__ = ["SendNudge", "NudgeCommand", "NudgeResult"]

NUDGE_WINDOW_SECONDS = 300.0  # 1 por conversa a cada 5 min por remetente
_BLOCKED_STATUSES = frozenset({"dnd", "offline"})


class SendNudge:
    def __init__(
        self,
        conversations: ConversationRepository,
        users: UserRepository,
        presence: PresenceDirectory,
        throttle: RateLimiter,
        events: EventBus,
    ) -> None:
        self._conversations = conversations
        self._users = users
        self._presence = presence
        self._throttle = throttle
        self._events = events

    async def execute(self, command: NudgeCommand) -> NudgeResult:
        conversation = await self._conversations.get_by_id(command.conversation_id)
        if conversation is None:
            raise NotFoundError("Conversa não encontrada.")

        sender = await self._users.get_by_id(command.sender_id)
        if sender is None:
            raise NotFoundError("Usuário não encontrado.")

        members = await self._conversations.list_members(command.conversation_id)
        sender_member = next(
            (m for m in members if m.user_id == sender.id and m.left_at is None), None
        )
        if sender_member is None:
            raise AccessDeniedError("Você não participa desta conversa.")
        active_members = [m for m in members if m.left_at is None and m.user_id != sender.id]

        eligible = frozenset(
            m.user_id
            for m in active_members
            if self._presence.status_of(m.user_id) not in _BLOCKED_STATUSES
        )
        if not eligible:
            # Recusa (DND/ninguém online) não consome o cooldown de 5 min.
            someone_online_dnd = any(
                self._presence.status_of(m.user_id) == "dnd" for m in active_members
            )
            reason = "dnd" if someone_online_dnd else "unavailable"
            return NudgeResult(delivered=False, reason=reason)

        throttle_key = f"nudge:{command.sender_id}:{command.conversation_id}"
        if not self._throttle.allow(throttle_key, 1, NUDGE_WINDOW_SECONDS):
            return NudgeResult(delivered=False, reason="throttled")

        await self._events.publish(
            AuditRequested(
                action="message.nudge",
                entity_type="conversation",
                entity_id=str(command.conversation_id),
                actor_id=sender.id,
                metadata={
                    "sender_id": str(sender.id),
                    "recipients": sorted(str(uid) for uid in eligible),
                },
            )
        )
        await self._events.publish(
            NudgeSent(
                conversation_id=command.conversation_id,
                sender_id=sender.id,
                sender_name=sender.display_name,
                recipient_ids=eligible,
            )
        )
        return NudgeResult(delivered=True, recipient_ids=eligible)
