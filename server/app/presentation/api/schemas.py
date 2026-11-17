from uuid import UUID

from pydantic import BaseModel, Field

from app.domain.entities.user import User


class UserOut(BaseModel):
    id: UUID
    username: str
    display_name: str
    role: str
    sector_id: UUID | None
    is_active: bool

    @classmethod
    def from_user(cls, user: User) -> "UserOut":
        return cls(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            role=user.role,
            sector_id=user.sector_id,
            is_active=user.is_active,
        )


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str
    device_name: str | None = Field(default=None, max_length=120)


class LoginOut(BaseModel):
    access_token: str
    refresh_token: str
    user: UserOut


class RefreshIn(BaseModel):
    refresh_token: str


class RefreshOut(BaseModel):
    access_token: str
    refresh_token: str


class CreateUserIn(BaseModel):
    username: str
    display_name: str
    password: str
    role: str = "member"
    sector_id: UUID | None = None


class UpdateUserIn(BaseModel):
    role: str | None = None
    sector_id: UUID | None = None
    is_active: bool | None = None


class CreateSectorIn(BaseModel):
    name: str
    description: str | None = None


class SectorOut(BaseModel):
    id: UUID
    name: str
    slug: str
    description: str | None
