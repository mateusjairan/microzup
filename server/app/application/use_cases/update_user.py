from typing import cast
from uuid import UUID

from app.application.dto import UpdateUserCommand
from app.application.events import AuditRequested, UserDeactivated
from app.domain.entities.conversation import Conversation, ConversationMember
from app.domain.entities.user import Role, User
from app.domain.exceptions import NotFoundError
from app.domain.ports.clock import Clock
from app.domain.ports.events import EventBus
from app.domain.ports.repositories import (
    ConversationRepository,
    SectorRepository,
    SessionRepository,
    UserRepository,
)
from app.domain.ports.unit_of_work import UnitOfWork

__all__ = ["UpdateUser", "UpdateUserCommand"]

_UNSET = object()


class UpdateUser:
    def __init__(
        self,
        users: UserRepository,
        uow: UnitOfWork,
        clock: Clock,
        events: EventBus,
        sectors: SectorRepository | None = None,
        conversations: ConversationRepository | None = None,
        sessions: SessionRepository | None = None,
    ) -> None:
        self._users = users
        self._uow = uow
        self._clock = clock
        self._events = events
        self._sectors = sectors
        self._conversations = conversations
        self._sessions = sessions

    async def execute(self, command: UpdateUserCommand) -> User:
        target = await self._users.get_or_raise(
            command.target_id, NotFoundError("Usuário não encontrado.")
        )

        now = self._clock.now()
        updated = target
        changes: dict[str, object] = {}
        sector_moved = False

        if command.is_active is not None and command.is_active != target.is_active:
            updated = updated.with_active(command.is_active, now)
            changes["is_active"] = command.is_active
        if command.role is not None and command.role != target.role:
            updated = updated.with_role(cast(Role, command.role), now)
            changes["role"] = command.role

        new_sector_id: object = _UNSET
        if command.sector_id is not None and command.sector_id != target.sector_id:
            new_sector_id = command.sector_id
        elif command.clear_sector and target.sector_id is not None:
            new_sector_id = None

        if new_sector_id is not _UNSET:
            if (
                new_sector_id is not None
                and self._sectors is not None
                and await self._sectors.get_by_id(cast(UUID, new_sector_id)) is None
            ):
                raise NotFoundError("Setor não encontrado.")
            updated = updated.with_sector(cast(UUID | None, new_sector_id), now)
            changes["sector_id"] = str(new_sector_id) if new_sector_id is not None else None
            sector_moved = True

        if not changes:
            return target

        active_sessions = (
            await self._sessions.list_active_by_user(target.id)
            if (command.is_active is False and self._sessions is not None)
            else []
        )

        async with self._uow:
            await self._users.update(updated)

            # Plano §5: canal de setor nasce com membros materializados quando o
            # usuário é criado/movido — sai do canal do setor antigo, entra no novo.
            if sector_moved and self._conversations is not None:
                await self._move_channel_membership(target, updated, command.actor_id)

            if self._sessions is not None:
                for session in active_sessions:
                    await self._sessions.update(session.revoke(now))

        if command.is_active is False:
            # Desativação → hub fecha os sockets WS abertos; sessões já revogadas acima.
            await self._events.publish(UserDeactivated(user_id=target.id))

        await self._events.publish(
            AuditRequested(
                action="user.update",
                entity_type="user",
                entity_id=str(target.id),
                actor_id=command.actor_id,
                metadata=dict(changes),
                ip=command.ip,
            )
        )
        return updated

    async def _move_channel_membership(
        self, previous: User, updated: User, actor_id: UUID | None
    ) -> None:
        assert self._conversations is not None
        now = self._clock.now()

        if previous.sector_id is not None:
            old_channel = await self._conversations.get_channel_by_sector(previous.sector_id)
            if old_channel is not None:
                membership = await self._conversations.get_member(old_channel.id, previous.id)
                if membership is not None and membership.left_at is None:
                    await self._conversations.update_member(membership.leave(now))

        if updated.sector_id is not None:
            new_channel = await self._conversations.get_channel_by_sector(updated.sector_id)
            if new_channel is None:
                new_channel = Conversation.create_channel(
                    updated.sector_id, updated.display_name, actor_id, now
                )
                await self._conversations.add(new_channel)
            membership = await self._conversations.get_member(new_channel.id, updated.id)
            if membership is None:
                await self._conversations.add_member(
                    ConversationMember.create(new_channel.id, updated.id, now)
                )
            elif membership.left_at is not None:
                await self._conversations.update_member(membership.rejoin(now))
