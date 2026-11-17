from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.session import UserSession
from app.infrastructure.db.mappers import session_to_domain, session_to_row
from app.infrastructure.db.models import UserSessionRow


class SqlAlchemySessionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, session: UserSession) -> None:
        self._session.add(session_to_row(session))
        await self._session.flush()

    async def update(self, session: UserSession) -> None:
        await self._session.merge(session_to_row(session))
        await self._session.flush()

    async def get_by_refresh_hash(self, refresh_hash: str) -> UserSession | None:
        row = await self._session.scalar(
            select(UserSessionRow).where(UserSessionRow.refresh_token_hash == refresh_hash)
        )
        return None if row is None else session_to_domain(row)
