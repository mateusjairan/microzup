from uuid import UUID

from fastapi import APIRouter, Response, status

from app.application.use_cases.messages import (
    DeleteMessageCommand,
    EditMessageCommand,
    SendMessageCommand,
)
from app.application.use_cases.search_messages import SearchMessagesCommand
from app.presentation.api.schemas import EditMessageIn, MessageOut, SendMessageIn
from app.presentation.deps import (
    CurrentUserDep,
    DeleteMessageDep,
    EditMessageDep,
    SearchMessagesDep,
    SendMessageDep,
)

router = APIRouter(tags=["messages"])


@router.get("/search", response_model=list[MessageOut])
async def search(q: str, current: CurrentUserDep, use_case: SearchMessagesDep) -> list[MessageOut]:
    messages = await use_case.execute(SearchMessagesCommand(user_id=current.id, query=q))
    return [MessageOut.from_message(message) for message in messages]


@router.post("/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def send_message(
    body: SendMessageIn, current: CurrentUserDep, use_case: SendMessageDep
) -> MessageOut:
    message = await use_case.execute(
        SendMessageCommand(
            conversation_id=body.conversation_id,
            sender_id=current.id,
            client_id=body.client_id,
            body=body.body,
            attachment_ids=frozenset(body.attachment_ids),
        )
    )
    return MessageOut.from_message(message)


@router.patch("/messages/{message_id}", response_model=MessageOut)
async def edit_message(
    message_id: UUID,
    body: EditMessageIn,
    current: CurrentUserDep,
    use_case: EditMessageDep,
) -> MessageOut:
    message = await use_case.execute(
        EditMessageCommand(message_id=message_id, actor_id=current.id, body=body.body)
    )
    return MessageOut.from_message(message)


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: UUID,
    current: CurrentUserDep,
    use_case: DeleteMessageDep,
) -> Response:
    await use_case.execute(DeleteMessageCommand(message_id=message_id, actor_id=current.id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
