import asyncio
from collections.abc import Awaitable, Callable

Subscriber = Callable[[object], Awaitable[None]]


class InMemoryEventBus:
    """Entrega eventos a assinantes no processo (suficiente para 1 worker no MVP)."""

    def __init__(self) -> None:
        self._subscribers: list[Subscriber] = []

    def subscribe(self, subscriber: Subscriber) -> None:
        self._subscribers.append(subscriber)

    async def publish(self, event: object) -> None:
        await asyncio.gather(*(subscriber(event) for subscriber in self._subscribers))


class NullEventBus:
    """Null Object (plano §4.2): evita `if bus is not None` em testes e CLI."""

    async def publish(self, event: object) -> None:
        return None
