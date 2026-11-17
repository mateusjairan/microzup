from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession


class SqlAlchemyUnitOfWork:
    """Uma transação por caso de uso: commit no sucesso, rollback na exceção."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def __aenter__(self) -> "SqlAlchemyUnitOfWork":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if exc_type is None:
            await self._session.commit()
        else:
            await self._session.rollback()
