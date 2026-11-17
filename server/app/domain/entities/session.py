from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID, uuid4


@dataclass(frozen=True, slots=True)
class UserSession:
    id: UUID
    user_id: UUID
    refresh_token_hash: str
    device_name: str | None
    ip: str | None
    user_agent: str | None
    created_at: datetime
    last_used_at: datetime
    revoked_at: datetime | None

    @classmethod
    def create(
        cls,
        user_id: UUID,
        refresh_token_hash: str,
        device_name: str | None,
        ip: str | None,
        user_agent: str | None,
        now: datetime,
    ) -> "UserSession":
        return cls(
            id=uuid4(),
            user_id=user_id,
            refresh_token_hash=refresh_token_hash,
            device_name=device_name,
            ip=ip,
            user_agent=user_agent,
            created_at=now,
            last_used_at=now,
            revoked_at=None,
        )

    def revoke(self, now: datetime) -> "UserSession":
        return replace(self, revoked_at=now, last_used_at=now)
