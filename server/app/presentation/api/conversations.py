from uuid import UUID

from fastapi import APIRouter, Query, Response, status

from app.application.use_cases.conversations import (
    OpenDirectMessageCommand,
)
from app.application.use_cases.messages import ListMessagesCommand, MarkReadCommand
from app.presentation.api.schemas import (
    ConversationOut,
    ConversationSummaryOut,
    MarkReadIn,
    MessageOut,
    OpenDmIn,
)
from app.presentation.deps import (
    CurrentUserDep,
    ListConversationsDep,
    ListMessagesDep,
    MarkReadDep,
    OpenDmDep,
)

router = APIRouter(tags=["conversations"])


@router.get("/conversations", response_model=list[ConversationSummaryOut])
async def list_conversations(
    current: CurrentUserDep, use_case: ListConversationsDep
) -> list[ConversationSummaryOut]:
    summaries = await use_case.execute(current.id)
    return [
        ConversationSummaryOut(
            conversation=ConversationOut(
                id=s.conversation.id,
                kind=s.conversation.kind,
                name=s.conversation.name,
                sector_id=s.conversation.sector_id,
                peer_id=s.peer_id,
            ),
            unread_count=s.unread_count,
            last_message=(MessageOut.from_message(s.last_message) if s.last_message else None),
        )
        for s in summaries
    ]


@router.post("/conversations/dm", response_model=ConversationOut)
async def open_dm(body: OpenDmIn, current: CurrentUserDep, use_case: OpenDmDep) -> ConversationOut:
    conversation = await use_case.execute(
        OpenDirectMessageCommand(actor_id=current.id, other_user_id=body.user_id)
    )
    return ConversationOut(
        id=conversation.id,
        kind=conversation.kind,
        name=conversation.name,
        sector_id=conversation.sector_id,
        peer_id=body.user_id,
    )


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
