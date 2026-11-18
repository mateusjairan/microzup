"""Decorator de rate limit para casos de uso (plano §8: em memória, 1 processo).

Aplicado por composição em `presentation/deps.py`: envolve o `execute` da instância
com uma checagem de janela deslizante antes de delegar.
"""

import functools
from collections.abc import Callable, Coroutine
from typing import Any, TypeVar

from app.domain.exceptions import RateLimitedError
from app.domain.ports.throttling import RateLimiter

C = TypeVar("C")
R = TypeVar("R")

ExecuteFn = Callable[[C], Coroutine[Any, Any, R]]
KeyFn = Callable[[Any], str]


def rate_limited(
    limiter: RateLimiter,
    *,
    scope: str,
    limit: int,
    window_seconds: float,
    key: KeyFn,
    message: str = "Muitas requisições em sequência. Aguarde alguns segundos e tente de novo.",
) -> Callable[[ExecuteFn[C, R]], ExecuteFn[C, R]]:
    """Decorator para o `execute` de um caso de uso: `limite` execuções por janela."""

    def decorate(execute: ExecuteFn[C, R]) -> ExecuteFn[C, R]:
        @functools.wraps(execute)
        async def wrapper(cmd: C) -> R:
            if not limiter.allow(f"{scope}:{key(cmd)}", limit, window_seconds):
                raise RateLimitedError(message)
            return await execute(cmd)

        return wrapper

    return decorate


def apply_rate_limit(
    use_case: Any,
    limiter: RateLimiter,
    *,
    scope: str,
    limit: int,
    window_seconds: float,
    key: KeyFn,
    message: str = "Muitas requisições em sequência. Aguarde alguns segundos e tente de novo.",
) -> None:
    """Envolve o `execute` da instância com o rate limit (composição na borda de DI)."""
    # setattr em vez de atribuição direta: mypy trata `uc.execute = ...` como
    # method-assign; setattr com a assinatura compatível passa na checagem.
    setattr(  # noqa: B010
        use_case,
        "execute",
        rate_limited(
            limiter,
            scope=scope,
            limit=limit,
            window_seconds=window_seconds,
            key=key,
            message=message,
        )(use_case.execute),
    )
