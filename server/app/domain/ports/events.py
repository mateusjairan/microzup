from typing import Protocol


class EventBus(Protocol):
    async def publish(self, event: object) -> None: ...
