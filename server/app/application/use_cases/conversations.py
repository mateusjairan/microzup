from uuid import UUID

from app.application.dto import (
    ChannelSummary,
    ConversationMemberInfo,
    ConversationSummary,
    GetConversationAudienceCommand,
    ListConversationMembersCommand,
    OpenDirectMessageCommand,
    OpenDirectMessageResult,
    UpdateChannelCommand,
)
from app.application.events import AuditRequested
from app.domain.entities.conversation import Conversation, ConversationFactory
from app.domain.exceptions import NotFoundError, ValidationError
from app.domain.policies.conversation_access import ConversationAccessPolicy
from app.domain.ports.clock import Clock
from app.domain.ports.events import EventBus
from app.domain.ports.presence import PresenceDirectory
from app.domain.ports.repositories import (
    ConversationRepository,
    MessageReadRepository,
    MessageRepository,
    SectorRepository,
    UserRepository,
)
from app.domain.ports.unit_of_work import UnitOfWork

__all__ = [
    "ChannelSummary",
    "ConversationSummary",
    "GetConversationAudience",
    "GetConversationAudienceCommand",
    "ListChannels",
    "ListConversationMembers",
    "ListConversationMembersCommand",
    "ListConversations",
    "OpenDirectMessage",
    "OpenDirectMessageCommand",
    "OpenDirectMessageResult",
    "UpdateChannel",
    "UpdateChannelCommand",
]

CHANNEL_NAME_MAX = 120


class OpenDirectMessage:
    def __init__(
        self,
        conversations: ConversationRepository,
        users: UserRepository,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._conversations = conversations
        self._users = users
        self._uow = uow
        self._clock = clock

    async def execute(self, command: OpenDirectMessageCommand) -> OpenDirectMessageResult:
        if command.actor_id == command.other_user_id:
            raise ValidationError("Não é possível abrir uma conversa consigo mesmo.")

        peer = await self._users.get_or_raise(
            command.other_user_id, NotFoundError("Usuário não encontrado.")
        )

        existing = await self._conversations.get_dm(command.actor_id, command.other_user_id)
        if existing is not None:
            # DM pré-existente continua acessível (histórico preservado) mesmo com par inativo.
            return OpenDirectMessageResult(
                conversation=existing, peer_id=peer.id, peer_is_active=peer.is_active
            )

        # Plano §2: DMs apenas entre usuários ativos.
        if not peer.is_active:
            raise ValidationError("Usuário desativado não pode receber mensagens diretas.")

        now = self._clock.now()
        conversation, members = ConversationFactory.open_dm(
            command.actor_id, command.other_user_id, now
        )

        async with self._uow:
            await self._conversations.add(conversation)
            await self._conversations.add_member(members[0])
            await self._conversations.add_member(members[1])

        return OpenDirectMessageResult(
            conversation=conversation, peer_id=peer.id, peer_is_active=True
        )


class ListConversations:
    def __init__(
        self,
        conversations: ConversationRepository,
        messages: MessageRepository,
        reads: MessageReadRepository,
        users: UserRepository,
    ) -> None:
        self._conversations = conversations
        self._messages = messages
        self._reads = reads
        self._users = users

    async def execute(self, user_id: UUID) -> list[ConversationSummary]:
        conversations = await self._conversations.list_for_user(user_id)
        summaries: list[ConversationSummary] = []
        for conversation in conversations:
            last_read_seq = await self._reads.get(conversation.id, user_id)
            unread = await self._messages.unread_count(conversation.id, last_read_seq)
            last_message = await self._messages.last(conversation.id)
            peer_id: UUID | None = None
            peer_is_active: bool | None = None
            if conversation.kind == "dm":
                members = await self._conversations.list_members(conversation.id)
                peer_id = next(
                    (member.user_id for member in members if member.user_id != user_id), None
                )
                if peer_id is not None:
                    peer = await self._users.get_by_id(peer_id)
                    peer_is_active = peer.is_active if peer is not None else False
            summaries.append(
                ConversationSummary(
                    conversation=conversation,
                    unread_count=unread,
                    last_read_seq=last_read_seq,
                    last_message=last_message,
                    peer_id=peer_id,
                    peer_is_active=peer_is_active,
                )
            )
        return summaries


class ListConversationMembers:
    """Membros de uma conversa após revalidar participação (plano §7.8).

    A UI usa a lista real com papel na conversa e presença efetiva do hub —
    para DM basta o par, para canal a lista materializada.
    """

    def __init__(
        self,
        conversations: ConversationRepository,
        users: UserRepository,
        policy: ConversationAccessPolicy,
        presence: PresenceDirectory,
    ) -> None:
        self._conversations = conversations
        self._users = users
        self._policy = policy
        self._presence = presence

    async def execute(
        self, command: ListConversationMembersCommand
    ) -> list[ConversationMemberInfo]:
        member = await self._conversations.get_member(command.conversation_id, command.requester_id)
        self._policy.ensure_can_read(member)

        members = await self._conversations.list_members(command.conversation_id)
        infos: list[ConversationMemberInfo] = []
        for entry in members:
            if entry.left_at is not None:
                continue
            user = await self._users.get_by_id(entry.user_id)
            if user is None:
                continue
            infos.append(
                ConversationMemberInfo(
                    user=user,
                    conversation_role=entry.role,
                    presence=self._presence.status_of(entry.user_id),
                )
            )
        return infos


class GetConversationAudience:
    """Membros ativos de uma conversa, após revalidar participação (usado pelo WS)."""

    def __init__(
        self,
        conversations: ConversationRepository,
        policy: ConversationAccessPolicy,
    ) -> None:
        self._conversations = conversations
        self._policy = policy

    async def execute(self, command: GetConversationAudienceCommand) -> frozenset[UUID]:
        member = await self._conversations.get_member(command.conversation_id, command.requester_id)
        self._policy.ensure_can_read(member)
        members = await self._conversations.list_members(command.conversation_id)
        return frozenset(m.user_id for m in members if m.left_at is None)


class ListChannels:
    def __init__(
        self,
        conversations: ConversationRepository,
        sectors: SectorRepository,
    ) -> None:
        self._conversations = conversations
        self._sectors = sectors

    async def execute(self) -> list[ChannelSummary]:
        channels = await self._conversations.list_channels()
        sectors = {sector.id: sector for sector in await self._sectors.list_all()}
        summaries: list[ChannelSummary] = []
        for channel in channels:
            members = await self._conversations.list_members(channel.id)
            summaries.append(
                ChannelSummary(
                    conversation=channel,
                    sector=sectors.get(channel.sector_id) if channel.sector_id else None,
                    member_count=len([m for m in members if m.left_at is None]),
                )
            )
        return summaries


class UpdateChannel:
    """Gerência mínima de canal pelo admin: renomear e arquivar/reabrir."""

    def __init__(
        self,
        conversations: ConversationRepository,
        events: EventBus,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None:
        self._conversations = conversations
        self._events = events
        self._uow = uow
        self._clock = clock

    async def execute(self, command: UpdateChannelCommand) -> Conversation:
        channel = await self._conversations.get_or_raise(
            command.channel_id, NotFoundError("Canal não encontrado.")
        )
        if channel.kind != "channel":
            raise NotFoundError("Canal não encontrado.")

        updated = channel
        changes: dict[str, object] = {}

        if command.name is not None:
            clean_name = " ".join(command.name.split())
            if not 2 <= len(clean_name) <= CHANNEL_NAME_MAX:
                raise ValidationError(
                    f"Nome do canal deve ter entre 2 e {CHANNEL_NAME_MAX} caracteres."
                )
            if clean_name != channel.name:
                updated = updated.with_name(clean_name)
                changes["name"] = clean_name

        if command.archived is not None:
            if command.archived and channel.archived_at is None:
                updated = updated.archive(self._clock.now())
                changes["archived"] = True
            elif not command.archived and channel.archived_at is not None:
                updated = updated.unarchive()
                changes["archived"] = False

        if not changes:
            return channel

        async with self._uow:
            await self._conversations.update(updated)

        await self._events.publish(
            AuditRequested(
                action="channel.update",
                entity_type="conversation",
                entity_id=str(channel.id),
                actor_id=command.actor_id,
                metadata=dict(changes),
                ip=command.ip,
            )
        )
        return updated
