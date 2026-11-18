from typing import ClassVar

from sqlalchemy import select

from app.domain.entities.user import User
from app.infrastructure.db.mappers import user_to_domain, user_to_row
from app.infrastructure.db.models import UserRow
from app.infrastructure.db.repositories.base import BaseSqlAlchemyRepository


class SqlAlchemyUserRepository(BaseSqlAlchemyRepository[UserRow, User]):
    _row_type: ClassVar[type[UserRow]] = UserRow

    def _to_domain(self, row: UserRow) -> User:
        return user_to_domain(row)

    async def add(self, user: User) -> None:
        self._session.add(user_to_row(user))
        await self._session.flush()

    async def update(self, user: User) -> None:
        await self._session.merge(user_to_row(user))
        await self._session.flush()

    async def get_by_username(self, username: str) -> User | None:
        row = await self._session.scalar(select(UserRow).where(UserRow.username == username))
        return None if row is None else user_to_domain(row)

    async def list_active(self) -> list[User]:
        rows = (
            await self._session.scalars(
                select(UserRow).where(UserRow.is_active.is_(True)).order_by(UserRow.display_name)
            )
        ).all()
        return [self._to_domain(row) for row in rows]

    async def list_all(self) -> list[User]:
        rows = (await self._session.scalars(select(UserRow).order_by(UserRow.display_name))).all()
        return [self._to_domain(row) for row in rows]

    async def exists_active_admin(self) -> bool:
        row = await self._session.scalar(
            select(UserRow.id).where(UserRow.role == "admin", UserRow.is_active.is_(True)).limit(1)
        )
        return row is not None
