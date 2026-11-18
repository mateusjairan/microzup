from collections.abc import Sequence
from typing import Any, ClassVar, TypeVar, cast
from uuid import UUID

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.exceptions import DomainError
from app.infrastructure.db.models import Base

RowT = TypeVar("RowT", bound=Base)
DomainT = TypeVar("DomainT")


class BaseSqlAlchemyRepository[RowT: Base, DomainT]:
    """Template Method (plano §4.2): sessão, `get_or_raise`, mapeamento e
    paginação por `seq` comuns — os repositórios herdam sem duplicar.
    """

    _row_type: ClassVar[type[RowT]]

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def _to_domain(self, row: RowT) -> DomainT:
        raise NotImplementedError

    async def get_by_id(self, entity_id: UUID) -> DomainT | None:
        row = await self._session.get(self._row_type, entity_id)
        return None if row is None else self._to_domain(row)

    async def get_or_raise(self, entity_id: UUID, error: DomainError) -> DomainT:
        found = await self.get_by_id(entity_id)
        if found is None:
            raise error
        return found

    async def page_by_seq(
        self,
        statement: Select[Any],
        # `Any`: InstrumentedAttribute (ORM) não satisfez a variância do mypy
        # contra ColumnElement; ambos suportam comparação/ordenação por seq.
        seq_column: Any,
        before_seq: int | None,
        after_seq: int | None,
        limit: int,
    ) -> list[RowT]:
        """Paginação por `seq` (plano §5): `before_seq` devolve a página mais
        recente em ordem cronológica; `after_seq` é o catch-up crescente.
        """
        if before_seq is not None:
            rows = (
                await self._session.scalars(
                    statement.where(seq_column < before_seq)
                    .order_by(seq_column.desc())
                    .limit(limit)
                )
            ).all()
            return list(reversed(cast("Sequence[RowT]", rows)))
        if after_seq is not None:
            statement = statement.where(seq_column > after_seq)
        rows = (
            await self._session.scalars(statement.order_by(seq_column.asc()).limit(limit))
        ).all()
        return list(cast("Sequence[RowT]", rows))
