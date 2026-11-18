from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.user import User
from app.infrastructure.db.mappers import user_to_domain, user_to_row
from app.infrastructure.db.models import UserRow


class SqlAlchemyUserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, user: User) -> None:
        self._session.add(user_to_row(user))
        await self._session.flush()

    async def update(self, user: User) -> None:
        await self._session.merge(user_to_row(user))
        await self._session.flush()

    async def get_by_id(self, user_id: UUID) -> User | None:
        row = await self._session.get(UserRow, user_id)
        return None if row is None else user_to_domain(row)

    async def get_by_username(self, username: str) -> User | None:
        row = await self._session.scalar(select(UserRow).where(UserRow.username == username))
        return None if row is None else user_to_domain(row)

    async def list_active(self) -> list[User]:
        rows = (
            await self._session.scalars(
                select(UserRow).where(UserRow.is_active.is_(True)).order_by(UserRow.display_name)
            )
        ).all()
        return [user_to_domain(row) for row in rows]

    async def list_all(self) -> list[User]:
        rows = (await self._session.scalars(select(UserRow).order_by(UserRow.display_name))).all()
        return [user_to_domain(row) for row in rows]
