"""Subscriber de auditoria (plano §4.2: "o caso de uso só publica o evento").

Reage a `AuditRequested` publicada pelos casos de uso e grava o `audit_log`
em transação própria, FORA da transação da regra de negócio — a auditoria é
efeito colateral reagido, nunca chamada dentro do caso de uso. Vive na
camada de apresentação porque é aqui (composition root) que application e
infrastructure se encontram, respeitando `presentation → application` e
`domain ← infrastructure`.
"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.events import AuditRequested
from app.infrastructure.db.repositories.audit import SqlAlchemyAuditSink


class AuditSubscriber:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._factory = session_factory

    async def on_event(self, event: object) -> None:
        if not isinstance(event, AuditRequested):
            return
        # Sessão própria: o caso de uso já commitou; o append no audit_log é
        # independente (audit_log só recebe INSERT, plano §5).
        async with self._factory() as session:
            await SqlAlchemyAuditSink(session).record(
                event.action,
                event.entity_type,
                event.entity_id,
                event.actor_id,
                event.metadata,
                event.ip,
            )
            await session.commit()
