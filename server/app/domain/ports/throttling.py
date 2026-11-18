from typing import Protocol


class RateLimiter(Protocol):
    """Limite deslizante em memória: `limit` eventos por `window_seconds` para cada chave.

    Suficiente para 1 processo (plano §8); a porta permite trocar por Redis na fase 2.
    """

    def allow(self, key: str, limit: int, window_seconds: float) -> bool: ...
