import time
from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass, field

MonotonicFn = Callable[[], float]


class InMemoryRateLimiter:
    """Janela deslizante por chave, em memória — suficiente para 1 processo (plano §8)."""

    def __init__(self, clock: MonotonicFn = time.monotonic) -> None:
        self._clock = clock
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, limit: int, window_seconds: float) -> bool:
        now = self._clock()
        events = self._events[key]
        cutoff = now - window_seconds
        while events and events[0] <= cutoff:
            events.popleft()
        if len(events) >= limit:
            return False
        events.append(now)
        return True


@dataclass
class _AttemptState:
    failures: int = 0
    lockouts: int = 0
    blocked_until: float = 0.0


@dataclass
class LoginAttemptTracker:
    """Bloqueio progressivo após N falhas por IP+usuário (plano §8).

    Duração do bloqueio dobra a cada ciclo (300 s → 600 s → … até 1 h);
    sucesso no login zera o histórico da chave.
    """

    max_attempts: int = 5
    base_lockout_seconds: float = 300.0
    max_lockout_seconds: float = 3600.0
    clock: MonotonicFn = field(default=time.monotonic)
    _states: dict[str, _AttemptState] = field(default_factory=dict)

    def blocked_for(self, key: str) -> float:
        state = self._states.get(key)
        if state is None:
            return 0.0
        return max(0.0, state.blocked_until - self.clock())

    def register_failure(self, key: str) -> None:
        state = self._states.setdefault(key, _AttemptState())
        state.failures += 1
        if state.failures >= self.max_attempts:
            duration = min(
                self.base_lockout_seconds * (2**state.lockouts), self.max_lockout_seconds
            )
            state.lockouts += 1
            state.failures = 0
            state.blocked_until = self.clock() + duration

    def register_success(self, key: str) -> None:
        self._states.pop(key, None)
