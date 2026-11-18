"""Decorator de idempotência por composição (plano §4.2: `@idempotent`).

Envolve o `execute` de um caso de uso com uma consulta prévia por chave de
idempotência — no Microzup, `(conversation_id, client_id)` do envio de
mensagem (plano §7). O uso de caso continua mantendo a checagem interna do
exemplo de referência (plano §4.3); este decorator é a camada transversal
aplicada na borda de DI, no mesmo estilo do `rate_limited`.
"""

import functools
from collections.abc import Awaitable, Callable, Coroutine
from typing import Any, TypeVar

C = TypeVar("C")
R = TypeVar("R")

ExecuteFn = Callable[[C], Coroutine[Any, Any, R]]
LookupFn = Callable[[C], Awaitable[R | None]]


def idempotent[C, R](lookup: LookupFn[C, R]) -> Callable[[ExecuteFn[C, R]], ExecuteFn[C, R]]:
    """Decorator para o `execute` de um caso de uso: retry com a mesma chave devolve o original."""

    def decorate(execute: ExecuteFn[C, R]) -> ExecuteFn[C, R]:
        @functools.wraps(execute)
        async def wrapper(cmd: C) -> R:
            existing = await lookup(cmd)
            if existing is not None:
                return existing  # retry não reexecuta, não reaudita, não renotifica
            return await execute(cmd)

        return wrapper

    return decorate


def apply_idempotency(use_case: Any, lookup: LookupFn[Any, Any]) -> None:
    """Envolve o `execute` da instância com a checagem de idempotência (composição na borda)."""
    setattr(  # noqa: B010
        use_case,
        "execute",
        idempotent(lookup)(use_case.execute),
    )
