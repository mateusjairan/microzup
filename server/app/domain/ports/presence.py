from typing import Protocol
from uuid import UUID


class PresenceDirectory(Protocol):
    """Consulta o status de presença efetivo (invisible aparece como offline)."""

    def status_of(self, user_id: UUID) -> str: ...
