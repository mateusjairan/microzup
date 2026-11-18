from uuid import UUID

from fastapi import APIRouter, Query, Response, status

from app.application.use_cases.conversations import (
    ListConversationMembersCommand,
    OpenDirectMessageCommand,
)
from app.application.use_cases.messages import ListMessagesCommand, MarkReadCommand
from app.domain.entities.conversation import Conversation
from app.presentation.api.schemas import (
    ConversationMemberOut,
    ConversationOut,
    ConversationSummaryOut,
    MarkReadIn,
    MessageOut,
    OpenDmIn,
)
from app.presentation.deps import (
    CurrentUserDep,
    ListConversationMembersDep,
    ListConversationsDep,
    ListMessagesDep,
    MarkReadDep,
    OpenDmDep,
)

router = APIRouter(tags=["conversations"])


def _conversation_out(
    conversation: Conversation,
    peer_id: UUID | None = None,
    peer_is_active: bool | None = None,
) -> ConversationOut:
    return ConversationOut(
        id=conversation.id,
        kind=conversation.kind,
        name=conversation.name,
        sector_id=conversation.sector_id,
        archived_at=(conversation.archived_at.isoformat() if conversation.archived_at else None),
        peer_id=peer_id,
        peer_is_active=peer_is_active,
    )


@router.get("/conversations", response_model=list[ConversationSummaryOut])
async def list_conversations(
    current: CurrentUserDep, use_case: ListConversationsDep
) -> list[ConversationSummaryOut]:
    summaries = await use_case.execute(current.id)
    return [
        ConversationSummaryOut(
            conversation=_conversation_out(
                s.conversation, peer_id=s.peer_id, peer_is_active=s.peer_is_active
            ),
            unread_count=s.unread_count,
            last_read_seq=s.last_read_seq,
            last_message=(MessageOut.from_message(s.last_message) if s.last_message else None),
        )
        for s in summaries
    ]


@router.post("/conversations/dm", response_model=ConversationOut)
async def open_dm(body: OpenDmIn, current: CurrentUserDep, use_case: OpenDmDep) -> ConversationOut:
    result = await use_case.execute(
        OpenDirectMessageCommand(actor_id=current.id, other_user_id=body.user_id)
    )
    return _conversation_out(
        result.conversation, peer_id=result.peer_id, peer_is_active=result.peer_is_active
    )


@router.get("/conversations/{conversation_id}/members", response_model=list[ConversationMemberOut])
async def list_conversation_members(
    conversation_id: UUID,
    current: CurrentUserDep,
    use_case: ListConversationMembersDep,
) -> list[ConversationMemberOut]:
    """Membros reais da conversa com papel e presença (autorização revalidada)."""
    infos = await use_case.execute(
        ListConversationMembersCommand(conversation_id=conversation_id, requester_id=current.id)
    )
    return [
        ConversationMemberOut(
            user_id=info.user.id,
            username=info.user.username,
            display_name=info.user.display_name,
            role=info.conversation_role,
            presence=info.presence,
        )
        for info in infos
    ]


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: UUID,
    current: CurrentUserDep,
    use_case: ListMessagesDep,
    before_seq: int | None = Query(default=None),
    after_seq: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[MessageOut]:
    messages = await use_case.execute(
        ListMessagesCommand(
            conversation_id=conversation_id,
            user_id=current.id,
            before_seq=before_seq,
            after_seq=after_seq,
            limit=limit,
        )
    )
    return [MessageOut.from_message(message) for message in messages]


@router.post("/conversations/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    conversation_id: UUID,
    body: MarkReadIn,
    current: CurrentUserDep,
    use_case: MarkReadDep,
) -> Response:
    await use_case.execute(
        MarkReadCommand(
            conversation_id=conversation_id,
            user_id=current.id,
            last_read_seq=body.last_read_seq,
        )
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
