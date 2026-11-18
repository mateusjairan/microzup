"""Decorator de auditoria para casos de uso (plano §4.2: `@audit`, por composição).

Mesmo estilo do `rate_limited`: o `execute` da instância é envolvido na borda
de DI (`presentation/deps.py`, `app.cli`). O uso de caso apenas executa a
regra; o decorator publica `AuditRequested` no EventBus e o subscriber grava
o audit_log — nenhum caso de uso conhece o repositório de auditoria.
"""

import functools
from collections.abc import Callable, Coroutine
from typing import Any, TypeVar
from uuid import UUID

from app.application.events import AuditRequested
from app.domain.ports.events import EventBus

C = TypeVar("C")
R = TypeVar("R")

ExecuteFn = Callable[[C], Coroutine[Any, Any, R]]
# Extratores recebem (comando, resultado) — como `key` do rate_limited recebe o comando.
EntityIdFn = Callable[[Any, Any], str | None]
ActorFn = Callable[[Any], UUID | None]
MetadataFn = Callable[[Any, Any], dict[str, Any]]
IpFn = Callable[[Any], str | None]


def audited(
    bus: EventBus,
    *,
    action: str | Callable[[Any], str],
    entity_type: str,
    entity_id: EntityIdFn,
    actor: ActorFn,
    metadata: MetadataFn | None = None,
    ip: IpFn | None = None,
) -> Callable[[ExecuteFn[C, R]], ExecuteFn[C, R]]:
    """Decorator para o `execute` de um caso de uso: publica a auditoria após o sucesso."""

    def decorate(execute: ExecuteFn[C, R]) -> ExecuteFn[C, R]:
        @functools.wraps(execute)
        async def wrapper(cmd: C) -> R:
            result = await execute(cmd)
            await bus.publish(
                AuditRequested(
                    action=action(cmd) if callable(action) else action,
                    entity_type=entity_type,
                    entity_id=entity_id(cmd, result),
                    actor_id=actor(cmd),
                    metadata=metadata(cmd, result) if metadata is not None else {},
                    ip=ip(cmd) if ip is not None else None,
                )
            )
            return result

        return wrapper

    return decorate


def apply_audit(
    use_case: Any,
    bus: EventBus,
    *,
    action: str | Callable[[Any], str],
    entity_type: str,
    entity_id: EntityIdFn,
    actor: ActorFn,
    metadata: MetadataFn | None = None,
    ip: IpFn | None = None,
) -> None:
    """Envolve o `execute` da instância com a auditoria (composição na borda de DI)."""
    setattr(  # noqa: B010
        use_case,
        "execute",
        audited(
            bus,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            actor=actor,
            metadata=metadata,
            ip=ip,
        )(use_case.execute),
    )
